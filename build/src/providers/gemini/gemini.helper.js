"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const generative_ai_1 = require("@google/generative-ai");
const usage_diagnostics_1 = require("../../core/diagnostics/usage-diagnostics");
const ai_error_1 = require("../../core/errors/ai.error");
const prompt_builder_1 = require("../../core/prompt/prompt.builder");
const cache_1 = require("../../core/utils/cache");
const retry_1 = require("../../core/utils/retry");
const DESC_EXCERPT_CHARS = 500;
const TAIL_OVERLAP_CHARS = 200;
function isRecord(v) {
    return typeof v === 'object' && v !== null;
}
function isString(v) {
    return typeof v === 'string';
}
class GeminiAIHelper {
    constructor(params) {
        this.config = params.config;
        this.logger = params.logger;
        this.client = params.client ?? new generative_ai_1.GoogleGenerativeAI(this.config.apiKey);
        this.cache = new cache_1.ModelCache((name) => {
            const supportsSystem = GeminiAIHelper.supportsSystemInstruction(name);
            return this.client.getGenerativeModel({
                model: name,
                ...(supportsSystem ? { systemInstruction: this.config.systemText } : {}),
            });
        });
    }
    async generatePullRequestContent(diffOutput, params) {
        try {
            const { model: modelName, temperature, maxOutputTokens, systemText } = this.config;
            const supportsSystem = GeminiAIHelper.supportsSystemInstruction(modelName);
            const unifiedPrompt = (0, prompt_builder_1.buildUnifiedPRPrompt)({ diff: diffOutput, currentTitle: params?.currentTitle, creator: params?.creator, rules: params?.rules });
            const promptPreview = (0, prompt_builder_1.previewText)(unifiedPrompt, prompt_builder_1.PROMPT_PREVIEW_LIMIT);
            this.logger.info(`[AI][Gemini]`);
            this.logger.startGroup(`Request`);
            this.logger.info(`[AI][Gemini] model=${modelName} temperature=${temperature} maxOutputTokens=${maxOutputTokens}`);
            this.logger.info(`[AI][Gemini] promptLength=${unifiedPrompt.length}`);
            this.logger.info(`[AI][Gemini] promptPreview:\n${promptPreview}`);
            this.logger.endGroup();
            const userText = (0, prompt_builder_1.buildUserPromptText)(systemText, unifiedPrompt, supportsSystem);
            const payload = (0, prompt_builder_1.buildGenerateRequest)({ userText, temperature, maxOutputTokens });
            const retryOutcome = await (0, retry_1.generateWithRetry)(async (activeModelName) => {
                const model = this.cache.getOrBuild(activeModelName);
                return model.generateContent(payload);
            }, { logger: this.logger, provider: 'Gemini', initialModel: modelName, retry: this.config.retry });
            const response = retryOutcome.value.response;
            let text = this.concatCandidatePartsText(response);
            const usage = response.usageMetadata;
            const finishReason = response.candidates?.[0]?.finishReason;
            this.logger.info(`[AI][Gemini]`);
            this.logger.startGroup(`Response`);
            this.logger.info(`[AI][Gemini] finishReason=${finishReason}`);
            this.logger.info(`[AI][Gemini] usage=${JSON.stringify(usage)}\n`);
            this.logger.info(`[AI][Gemini] raw response:\n${JSON.stringify(response)}`);
            this.logger.info(`[AI][Gemini] rawTextLength=${text.length}`);
            this.logger.info(`[AI][Gemini] raw text:\n${text}`);
            this.logger.endGroup();
            const diag = (0, usage_diagnostics_1.buildUsageDiagnostics)(usage, text);
            this.logger.info(`[AI][Gemini]`);
            this.logger.startGroup(`Usage Diagnostics`);
            this.logger.info(`[AI][Gemini] prompt=${diag.promptTokens} total=${diag.totalTokens} output=${Math.max(0, diag.totalTokens - diag.promptTokens)} candidates=${diag.candidateTokens}`);
            if (diag.inferenceNote)
                this.logger.info(`[AI][Gemini] notes=${diag.inferenceNote}`);
            this.logger.info(`[AI][Gemini] ⚠️ ${Math.round(diag.thoughtsRatio * 100)}% internal reasoning, ✅ ${Math.round(diag.visibleRatio * 100)}% visible output`);
            this.logger.endGroup();
            if (diag.totalTokens - diag.promptTokens === 0) {
                this.logger.warn('[AI][Gemini] No output tokens reported by API; consider increasing maxOutputTokens if finishReason=MAX_TOKENS.');
            }
            else if (diag.thoughtsRatio > 0.9) {
                this.logger.warn('[AI][Gemini] High thoughts/output token ratio (>90%). Consider increasing maxOutputTokens or tightening the prompt.');
            }
            // First, try to parse strict JSON result
            let parsed = null;
            try {
                parsed = this.parseUnifiedContent(text);
            }
            catch (_) {
                parsed = null;
            }
            // If we have an empty output from MAX_TOKENS, retry with a bump
            if (!parsed && finishReason === generative_ai_1.FinishReason.MAX_TOKENS && (!text || text.trim().length === 0)) {
                const bumped = Math.ceil(maxOutputTokens * 1.5);
                this.logger.info(`[AI][Gemini] MAX_TOKENS with empty output; retry maxOutputTokens=${bumped}`);
                const retryOutcome2 = await (0, retry_1.generateWithRetry)(async (activeModelName) => {
                    const model = this.cache.getOrBuild(activeModelName);
                    const rp = (0, prompt_builder_1.buildGenerateRequest)({ userText, temperature, maxOutputTokens: bumped });
                    return model.generateContent(rp);
                }, { logger: this.logger, provider: 'Gemini', initialModel: retryOutcome.modelUsed, retry: this.config.retry });
                const retryResp = retryOutcome2.value.response;
                text = this.concatCandidatePartsText(retryResp);
                try {
                    parsed = this.parseUnifiedContent(text);
                }
                catch (_) {
                    parsed = null;
                }
            }
            // If still unparsed (likely truncated JSON), attempt a JSON-mode tail continuation
            if (!parsed) {
                const cleaned = this.stripCodeFences(text);
                const titleObj = this.extractTitleObject(cleaned);
                const partialDesc = this.extractDescriptionPrefix(cleaned);
                if (!titleObj || !partialDesc) {
                    throw new ai_error_1.AIError('Gemini unified content parse error: non-JSON output', { provider: 'Gemini' });
                }
                const partialDescUnescaped = this.unescapeJsonStringFragment(partialDesc);
                const tailMax = Math.min(Math.ceil(maxOutputTokens * 1.5), 4096);
                this.logger.info('[AI][Gemini] continuation: truncated JSON detected; requesting JSON tail only...');
                const retryOutcome3 = await (0, retry_1.generateWithRetry)(async (activeModelName) => {
                    const model = this.cache.getOrBuild(activeModelName);
                    const contPayload = this.buildTailContinuationRequest(partialDescUnescaped, temperature, tailMax, params?.rules);
                    return model.generateContent(contPayload);
                }, { logger: this.logger, provider: 'Gemini', initialModel: retryOutcome.modelUsed, retry: this.config.retry });
                const contResp = retryOutcome3.value.response;
                const contText = this.concatCandidatePartsText(contResp);
                this.logger.info(`[AI][Gemini] Tail raw:\n${contText}`);
                const tailObj = this.tryParseJson(contText);
                if (!this.isTailResponse(tailObj)) {
                    throw new ai_error_1.AIError('Gemini unified content parse error: continuation did not return description_tail', { provider: 'Gemini' });
                }
                const finalDescription = this.appendTailWithOverlap(partialDescUnescaped, tailObj.description_tail);
                parsed = {
                    title: (titleObj.conventional || titleObj.subject || '').toString().trim(),
                    description: finalDescription,
                    meta: {
                        type: titleObj.type || undefined,
                        scope: titleObj.scope || undefined,
                        subject: titleObj.subject || undefined,
                    },
                };
            }
            // Parsed successfully at this point
            this.logger.info(`[AI][Gemini] content: titleLength=${parsed.title.length} descLength=${parsed.description.length}`);
            return parsed;
        }
        catch (error) {
            const status = typeof error?.status === 'number' ? error.status : undefined;
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`[AI][Gemini] ❌ exception status=${status ?? 'n/a'} message=${msg}`);
            throw ai_error_1.AIError.wrap(`Gemini API Error: ${msg}`, { provider: 'Gemini', statusCode: status });
        }
    }
    static supportsSystemInstruction(name) {
        return name.toLowerCase().startsWith('gemini-2');
    }
    concatCandidatePartsText(resp) {
        const partsMaybe = resp?.candidates?.[0]?.content?.parts;
        const buf = [];
        if (Array.isArray(partsMaybe)) {
            for (const p of partsMaybe) {
                if (isRecord(p) && 'text' in p && isString(p.text)) {
                    buf.push(p.text);
                }
            }
        }
        if (buf.length === 0) {
            try {
                return resp.text()?.trim?.() || '';
            }
            catch { /* ignore */ }
        }
        return buf.join('').trim();
    }
    stripCodeFences(text) {
        if (!text)
            return '';
        return text
            .replace(/^```[a-zA-Z]*\s*$/gm, '')
            .replace(/```\s*$/gm, '')
            .trim();
    }
    tryParseJson(s) {
        try {
            return JSON.parse(s);
        }
        catch { /* ignore */ }
        const start = s.indexOf('{');
        const end = s.lastIndexOf('}');
        if (start >= 0 && end > start) {
            const sliced = s.slice(start, end + 1);
            try {
                return JSON.parse(sliced);
            }
            catch { /* ignore */ }
        }
        return null;
    }
    extractTitleObject(text) {
        const m = /"title"\s*:\s*\{([\s\S]*?)\}/m.exec(text);
        if (!m)
            return null;
        const objRaw = '{' + m[1] + '}';
        const rec = this.tryParseJson(objRaw);
        if (!isRecord(rec))
            return null;
        return {
            subject: isString(rec.subject) ? rec.subject : undefined,
            type: isString(rec.type) ? rec.type : rec.type === null ? null : undefined,
            scope: isString(rec.scope) ? rec.scope : rec.scope === null ? null : undefined,
            conventional: isString(rec.conventional) ? rec.conventional : undefined,
        };
    }
    extractDescriptionPrefix(text) {
        const re = /"description"\s*:\s*"/m;
        const m = re.exec(text);
        if (!m)
            return null;
        const start = (m.index || 0) + m[0].length;
        return text.slice(start);
    }
    unescapeJsonStringFragment(s) {
        if (!s)
            return '';
        // Do a best-effort unescape for common sequences, even if the string is truncated
        let out = s;
        out = out.replace(/\\\\/g, '\\'); // \\ -> \
        out = out.replace(/\\"/g, '"'); // \" -> "
        out = out.replace(/\\n/g, '\n'); // \n -> newline char
        out = out.replace(/\\r/g, ''); // drop \r
        out = out.replace(/\\t/g, '\t'); // \t -> tab
        return out;
    }
    buildTailContinuationRequest(prefix, temperature, maxOutputTokens, rules) {
        const excerpt = prefix.length > DESC_EXCERPT_CHARS ? prefix.slice(-DESC_EXCERPT_CHARS) : prefix;
        const tailSchema = {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: { description_tail: { type: generative_ai_1.SchemaType.STRING } },
            required: ['description_tail'],
        };
        const instruction = [
            'The previous JSON response was truncated due to token limits.',
            'You already produced the beginning of the "description".',
            'Continue EXACTLY from where it stopped and return only the missing remainder.',
            '',
            'Output STRICT JSON only with this shape:',
            '{ "description_tail": string }',
            '',
            'Rules:',
            '- Do NOT repeat any part already produced.',
            '- Keep the same style and structure (continue the Markdown list if it was started).',
            '- Do not re-emit the "title".',
            '- No code fences, no commentary.',
            `- Stay within the original limits: max ${rules?.descMaxItems ?? 5} items, each ≤ ${rules?.descMaxWordsPerItem ?? 25} words, total ≤ ${rules?.descMaxTotalWords ?? 300} words.`,
        ].join('\n');
        const contextMsg = 'Here is the last ' + String(DESC_EXCERPT_CHARS) + ' characters of the description you already produced:\n' + excerpt;
        return {
            contents: [
                { role: 'user', parts: [{ text: instruction }] },
                { role: 'user', parts: [{ text: contextMsg }] },
            ],
            generationConfig: {
                temperature,
                maxOutputTokens,
                responseMimeType: 'application/json',
                responseSchema: tailSchema,
            },
        };
    }
    appendTailWithOverlap(base, tail, overlap = TAIL_OVERLAP_CHARS) {
        const b = base || '';
        const t = tail || '';
        if (!b)
            return (b + t).trim();
        const suffix = b.slice(-overlap);
        if (t.startsWith(suffix)) {
            return (b + t.slice(suffix.length)).trim();
        }
        return (b + t).trim();
    }
    isTailResponse(obj) {
        return isRecord(obj) && isString(obj.description_tail);
    }
    parseUnifiedContent(text) {
        const tryParse = (s) => { try {
            return JSON.parse(s);
        }
        catch {
            return null;
        } };
        let objUnknown = tryParse(text);
        if (!objUnknown) {
            const start = text.indexOf('{');
            const end = text.lastIndexOf('}');
            if (start >= 0 && end > start) {
                objUnknown = tryParse(text.slice(start, end + 1));
            }
        }
        if (!isRecord(objUnknown)) {
            throw new ai_error_1.AIError('Gemini unified content parse error: non-JSON output', { provider: 'Gemini' });
        }
        const obj = objUnknown;
        const titleObj = obj.title || {};
        const subject = isString(titleObj.subject) ? titleObj.subject : String(titleObj.subject ?? '');
        const type = isString(titleObj.type) ? titleObj.type : undefined;
        const scope = isString(titleObj.scope) ? titleObj.scope : undefined;
        const conventional = isString(titleObj.conventional) ? titleObj.conventional : undefined;
        const description = isString(obj.description) ? obj.description : String(obj.description ?? '');
        const title = (conventional || subject || '').toString().trim();
        return {
            title,
            description: description || '',
            meta: {
                type: type || undefined,
                scope: scope || undefined,
                subject: subject || undefined,
            },
        };
    }
}
exports.default = GeminiAIHelper;
