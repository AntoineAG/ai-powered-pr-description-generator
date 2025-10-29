"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const usage_diagnostics_1 = require("../../core/diagnostics/usage-diagnostics");
const ai_error_1 = require("../../core/errors/ai.error");
const prompt_builder_1 = require("../../core/prompt/prompt.builder");
const retry_1 = require("../../core/utils/retry");
class OpenAIHelper {
    constructor(params) {
        this.config = params.config;
        this.logger = params.logger;
    }
    async generatePullRequestContent(diffOutput, params) {
        const { model, temperature, systemText } = this.config;
        const unifiedPrompt = (0, prompt_builder_1.buildUnifiedPRPrompt)({ diff: diffOutput, currentTitle: params?.currentTitle, creator: params?.creator, rules: params?.rules });
        const promptPreview = (0, prompt_builder_1.previewText)(unifiedPrompt, prompt_builder_1.PROMPT_PREVIEW_LIMIT);
        try {
            this.logger.info(`[AI][OpenAI] ::group::Request`);
            this.logger.info(`[AI][OpenAI] model=${model} temperature=${temperature}`);
            this.logger.info(`[AI][OpenAI] promptLength=${unifiedPrompt.length}`);
            this.logger.info(`[AI][OpenAI] promptPreview:\n${promptPreview}`);
            this.logger.info(`::endgroup::`);
            const perform = async (activeModel) => {
                const response = await fetch((this.config.baseUrl || 'https://api.openai.com') + '/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.config.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: activeModel,
                        messages: [
                            { role: 'system', content: systemText },
                            { role: 'user', content: unifiedPrompt },
                        ],
                        temperature,
                        max_tokens: this.config.maxOutputTokens,
                    }),
                });
                const raw = await response.text();
                if (!response.ok) {
                    throw new ai_error_1.AIError(`OpenAI API HTTP ${response.status}: ${raw}`, { provider: 'OpenAI', model: activeModel, statusCode: response.status });
                }
                let data;
                try {
                    data = JSON.parse(raw);
                }
                catch (e) {
                    throw new ai_error_1.AIError('OpenAI API parse error', { provider: 'OpenAI', model: activeModel }, e);
                }
                if (data.error) {
                    throw new ai_error_1.AIError(`OpenAI API Error: ${data.error.message}`, { provider: 'OpenAI', model: activeModel, statusCode: data.error?.code });
                }
                return data;
            };
            const retryOutcome = await (0, retry_1.generateWithRetry)(perform, {
                logger: this.logger,
                provider: 'OpenAI',
                initialModel: model,
                retry: this.config.retry,
            });
            let text = (retryOutcome.value.choices?.[0]?.message?.content || '').trim();
            const finishReason = retryOutcome.value.choices?.[0]?.finish_reason || retryOutcome.value.choices?.[0]?.finishReason;
            const usage = retryOutcome.value.usage || {};
            this.logger.info(`[AI][OpenAI] ::group::Response`);
            this.logger.info(`[AI][OpenAI] finishReason=${finishReason}`);
            this.logger.info(`[AI][OpenAI] usage=${JSON.stringify(usage)} rawLength=${text.length}`);
            this.logger.info(`[AI][OpenAI] raw:\n${text}`);
            this.logger.info(`::endgroup::`);
            const diag = (0, usage_diagnostics_1.buildUsageDiagnostics)(usage, text);
            this.logger.info(`[AI][OpenAI] ::group::Usage Diagnostics`);
            this.logger.info(`[AI][OpenAI] prompt=${diag.promptTokens} total=${diag.totalTokens} output=${Math.max(0, diag.totalTokens - diag.promptTokens)} candidates=${diag.candidateTokens}`);
            if (diag.inferenceNote)
                this.logger.info(`[AI][OpenAI] notes=${diag.inferenceNote}`);
            this.logger.info(`[AI][OpenAI] ⚠️ ${Math.round(diag.thoughtsRatio * 100)}% internal reasoning, ✅ ${Math.round(diag.visibleRatio * 100)}% visible output`);
            this.logger.info(`::endgroup::`);
            // If output was cut by token limit, try a single continuation
            if (finishReason === 'length') {
                this.logger.info('[AI][OpenAI] continuation: finish_reason=length, requesting more...');
                const performCont = async (activeModel) => {
                    const resp = await fetch((this.config.baseUrl || 'https://api.openai.com') + '/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${this.config.apiKey}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            model: activeModel,
                            messages: [
                                { role: 'system', content: systemText },
                                { role: 'user', content: unifiedPrompt },
                                { role: 'assistant', content: text },
                                { role: 'user', content: 'Continue from where you left off. Do not repeat earlier content. Keep the same structure and style.' },
                            ],
                            temperature,
                            max_tokens: Math.floor(this.config.maxOutputTokens / 2),
                        }),
                    });
                    const raw = await resp.text();
                    if (!resp.ok) {
                        throw new ai_error_1.AIError(`OpenAI API HTTP ${resp.status}: ${raw}`, { provider: 'OpenAI', model: activeModel, statusCode: resp.status });
                    }
                    let data;
                    try {
                        data = JSON.parse(raw);
                    }
                    catch (e) {
                        throw new ai_error_1.AIError('OpenAI API parse error', { provider: 'OpenAI', model: activeModel }, e);
                    }
                    if (data.error) {
                        throw new ai_error_1.AIError(`OpenAI API Error: ${data.error.message}`, { provider: 'OpenAI', model: activeModel, statusCode: data.error?.code });
                    }
                    return data;
                };
                const contOutcome = await (0, retry_1.generateWithRetry)(performCont, {
                    logger: this.logger,
                    provider: 'OpenAI',
                    initialModel: model,
                    retry: this.config.retry,
                });
                const more = (contOutcome.value.choices?.[0]?.message?.content || '').trim();
                const fr2 = contOutcome.value.choices?.[0]?.finish_reason || contOutcome.value.choices?.[0]?.finishReason;
                this.logger.info(`[AI][OpenAI] Continuation finishReason=${fr2} moreLength=${more.length}`);
                this.logger.info(`[AI][OpenAI] more:\n${more}`);
                text = (text + '\n\n' + more).trim();
            }
            const parsed = this.parseUnifiedContent(text);
            this.logger.info(`[AI][OpenAI] content: titleLength=${parsed.title.length} descLength=${parsed.description.length}`);
            return parsed;
        }
        catch (error) {
            const status = error?.statusCode || error?.status;
            const msg = error?.message ? String(error.message) : String(error);
            this.logger.error(`[AI][OpenAI] ❌ exception status=${status ?? 'n/a'} message=${msg}`);
            throw ai_error_1.AIError.wrap(`OpenAI API Error: ${msg}`, { provider: 'OpenAI', statusCode: status });
        }
    }
    parseUnifiedContent(text) {
        const tryParse = (s) => { try {
            return JSON.parse(s);
        }
        catch {
            return null;
        } };
        let obj = tryParse(text);
        if (!obj) {
            const start = text.indexOf('{');
            const end = text.lastIndexOf('}');
            if (start >= 0 && end > start) {
                obj = tryParse(text.slice(start, end + 1));
            }
        }
        if (!obj || typeof obj !== 'object') {
            throw new ai_error_1.AIError('OpenAI unified content parse error: non-JSON output', { provider: 'OpenAI' });
        }
        const titleObj = obj.title || {};
        const subject = (titleObj.subject || '').toString();
        const type = titleObj.type ? String(titleObj.type) : undefined;
        const scope = titleObj.scope ? String(titleObj.scope) : undefined;
        const conventional = titleObj.conventional ? String(titleObj.conventional) : undefined;
        const description = (obj.description || '').toString();
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
exports.default = OpenAIHelper;
