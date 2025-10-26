"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const generative_ai_1 = require("@google/generative-ai");
const model_cache_1 = require("./model-cache");
const prompt_utils_1 = require("./prompt-utils");
const retry_utils_1 = require("./retry-utils");
const usage_diagnostics_1 = require("./usage-diagnostics");
const ai_error_1 = require("./ai-error");
class GeminiAIHelper {
    constructor(params) {
        this.config = params.config;
        this.logger = params.logger;
        const client = new generative_ai_1.GoogleGenerativeAI(this.config.apiKey);
        this.cache = new model_cache_1.ModelCache((name) => {
            const supportsSystem = this.supportsSystemInstruction(name);
            const modelParams = {
                model: name,
                ...(supportsSystem ? { systemInstruction: this.config.systemText } : {}),
            };
            return client.getGenerativeModel(modelParams);
        });
    }
    async createPullRequestDescription(_diffOutput, prompt) {
        try {
            const { model: modelName, temperature, maxOutputTokens, systemText } = this.config;
            const supportsSystem = this.supportsSystemInstruction(modelName);
            const promptPreview = (0, prompt_utils_1.previewText)(prompt, prompt_utils_1.PROMPT_PREVIEW_LIMIT);
            this.logger.info(`[AI][Gemini] ::group::Request`);
            this.logger.info(`[AI][Gemini] model=${modelName} temperature=${temperature} maxOutputTokens=${maxOutputTokens}`);
            this.logger.info(`[AI][Gemini] promptLength=${prompt.length}`);
            this.logger.info(`[AI][Gemini] promptPreview:\n${promptPreview}`);
            this.logger.info(`::endgroup::`);
            const userText = (0, prompt_utils_1.buildUserPromptText)(systemText, prompt, supportsSystem);
            const payload = (0, prompt_utils_1.buildGenerateRequest)({ userText, temperature, maxOutputTokens });
            const retryOutcome = await (0, retry_utils_1.generateWithRetry)(async (activeModelName) => {
                const model = this.cache.getOrBuild(activeModelName);
                return model.generateContent(payload);
            }, { logger: this.logger, provider: 'Gemini', initialModel: modelName, retry: this.config.retry });
            const response = retryOutcome.value.response;
            let text = this.concatCandidatePartsText(response);
            const usage = response.usageMetadata || retryOutcome.value.usageMetadata || undefined;
            const finishReason = response.candidates?.[0]?.finishReason;
            this.logger.info(`[AI][Gemini] ::group::Response`);
            this.logger.info(`[AI][Gemini] finishReason=${finishReason}`);
            this.logger.info(`[AI][Gemini] usage=${JSON.stringify(usage)} descLength=${text.length}`);
            this.logger.info(`[AI][Gemini] description:\n${text}`);
            this.logger.info(`::endgroup::`);
            const diag = (0, usage_diagnostics_1.buildUsageDiagnostics)(usage, text);
            this.logger.info(`[AI][Gemini] ::group::Usage Diagnostics`);
            this.logger.info(`[AI][Gemini] prompt=${diag.promptTokens} total=${diag.totalTokens} output=${Math.max(0, diag.totalTokens - diag.promptTokens)} candidates=${diag.candidateTokens}`);
            if (diag.inferenceNote)
                this.logger.info(`[AI][Gemini] notes=${diag.inferenceNote}`);
            this.logger.info(`[AI][Gemini] ⚠️ ${Math.round(diag.thoughtsRatio * 100)}% internal reasoning, ✅ ${Math.round(diag.visibleRatio * 100)}% visible output`);
            this.logger.info(`::endgroup::`);
            if (diag.totalTokens - diag.promptTokens === 0) {
                this.logger.warn('[AI][Gemini] No output tokens reported by API; consider increasing maxOutputTokens if finishReason=MAX_TOKENS.');
            }
            else if (diag.thoughtsRatio > 0.9) {
                this.logger.warn('[AI][Gemini] High thoughts/output token ratio (>90%). Consider increasing maxOutputTokens or tightening the prompt.');
            }
            if (finishReason === generative_ai_1.FinishReason.MAX_TOKENS) {
                if (!text || text.trim().length === 0) {
                    const bumped = Math.ceil(maxOutputTokens * 1.5);
                    this.logger.info(`[AI][Gemini] MAX_TOKENS with empty output; retry maxOutputTokens=${bumped}`);
                    const retryPayload = (0, prompt_utils_1.buildGenerateRequest)({ userText, temperature, maxOutputTokens: bumped });
                    const res = await this.cache.getOrBuild(retryOutcome.modelUsed).generateContent(retryPayload);
                    const retryResp = res.response;
                    const retryText = this.concatCandidatePartsText(retryResp);
                    const frRetry = retryResp.candidates?.[0]?.finishReason;
                    this.logger.info(`[AI][Gemini] Retry finishReason=${frRetry} length=${retryText.length}`);
                    text = retryText;
                }
                else {
                    this.logger.info('[AI][Gemini] continuation: MAX_TOKENS with non-empty output, requesting continuation...');
                    const contPayload = {
                        contents: (0, prompt_utils_1.buildContinuationParts)(text, prompt),
                        generationConfig: { temperature, maxOutputTokens },
                    };
                    const cont = await this.cache.getOrBuild(retryOutcome.modelUsed).generateContent(contPayload);
                    const contResp = cont.response;
                    const more = this.concatCandidatePartsText(contResp);
                    const fr2 = contResp.candidates?.[0]?.finishReason;
                    this.logger.info(`[AI][Gemini] Continuation finishReason=${fr2} moreLength=${more.length}`);
                    this.logger.info(`[AI][Gemini] more:\n${more}`);
                    text = (text + '\n\n' + more).trim();
                }
            }
            return text;
        }
        catch (error) {
            const status = error?.status;
            const msg = error?.message ? String(error.message) : String(error);
            this.logger.error(`[AI][Gemini] ❌ exception status=${status ?? 'n/a'} message=${msg}`);
            throw ai_error_1.AIError.wrap(`Gemini API Error: ${msg}`, { provider: 'Gemini', statusCode: status });
        }
    }
    supportsSystemInstruction(name) {
        return name.toLowerCase().startsWith('gemini-2');
    }
    concatCandidatePartsText(resp) {
        const parts = resp?.candidates?.[0]?.content?.parts || [];
        const buf = [];
        for (const p of parts) {
            if (typeof p?.text === 'string')
                buf.push(p.text);
        }
        if (buf.length === 0) {
            try {
                return resp.text()?.trim?.() || '';
            }
            catch { /* ignore */ }
        }
        return buf.join('').trim();
    }
}
exports.default = GeminiAIHelper;
