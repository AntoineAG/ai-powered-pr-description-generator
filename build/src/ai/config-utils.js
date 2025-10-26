"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_RETRY_CONFIG = exports.MIN_MAX_OUTPUT_TOKENS = exports.DEFAULT_MAX_OUTPUT_TOKENS = void 0;
exports.clampMaxOutputTokens = clampMaxOutputTokens;
exports.readIntEnv = readIntEnv;
exports.buildRetryConfigFromEnv = buildRetryConfigFromEnv;
exports.buildProviderCommonConfig = buildProviderCommonConfig;
exports.buildGeminiConfig = buildGeminiConfig;
exports.buildOpenAIConfig = buildOpenAIConfig;
exports.DEFAULT_MAX_OUTPUT_TOKENS = 1536;
exports.MIN_MAX_OUTPUT_TOKENS = 768;
exports.DEFAULT_RETRY_CONFIG = {
    maxAttempts: 8,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    jitterMs: 250,
    consecutive503ToSwitch: 10,
    modelLadder: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-flash'],
};
function clampMaxOutputTokens(value) {
    if (!Number.isFinite(value) || value <= 0)
        return exports.DEFAULT_MAX_OUTPUT_TOKENS;
    return Math.max(exports.MIN_MAX_OUTPUT_TOKENS, Math.floor(value));
}
function readIntEnv(name, fallback) {
    const raw = (process.env[name] || '').trim();
    if (!raw)
        return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
}
function buildRetryConfigFromEnv(base) {
    return {
        maxAttempts: readIntEnv('RETRY_MAX_ATTEMPTS', base?.maxAttempts) ?? exports.DEFAULT_RETRY_CONFIG.maxAttempts,
        baseDelayMs: readIntEnv('RETRY_BASE_DELAY_MS', base?.baseDelayMs) ?? exports.DEFAULT_RETRY_CONFIG.baseDelayMs,
        maxDelayMs: readIntEnv('RETRY_MAX_DELAY_MS', base?.maxDelayMs) ?? exports.DEFAULT_RETRY_CONFIG.maxDelayMs,
        jitterMs: readIntEnv('RETRY_JITTER_MS', base?.jitterMs) ?? exports.DEFAULT_RETRY_CONFIG.jitterMs,
        consecutive503ToSwitch: readIntEnv('RETRY_CONSEC_503_SWITCH', base?.consecutive503ToSwitch) ?? exports.DEFAULT_RETRY_CONFIG.consecutive503ToSwitch,
        modelLadder: base?.modelLadder ?? exports.DEFAULT_RETRY_CONFIG.modelLadder,
    };
}
function buildProviderCommonConfig(params) {
    const maxOutputTokensEnv = clampMaxOutputTokens(readIntEnv('MAX_OUTPUT_TOKENS', params.maxOutputTokens));
    return {
        model: params.model,
        temperature: params.temperature,
        maxOutputTokens: maxOutputTokensEnv,
        systemText: params.systemText,
        retry: buildRetryConfigFromEnv(params.retry),
    };
}
function buildGeminiConfig(aiParams, options) {
    const providerDefaults = {
        model: (aiParams.model || 'gemini-2.5-flash').trim(),
        temperature: aiParams.temperature,
        systemText: (options?.systemText || 'You are very good at reviewing code and can generate pull request descriptions.').trim(),
    };
    const common = buildProviderCommonConfig(providerDefaults);
    return {
        apiKey: aiParams.apiKey,
        ...common,
    };
}
function buildOpenAIConfig(aiParams, options) {
    const providerDefaults = {
        model: (aiParams.model || 'gpt-4.1').trim(),
        temperature: aiParams.temperature,
        systemText: (options?.systemText || 'You are a super assistant, very good at reviewing code, and can generate the best pull request descriptions.').trim(),
    };
    const common = buildProviderCommonConfig({ ...providerDefaults, retry: { modelLadder: options?.modelLadder } });
    return {
        apiKey: aiParams.apiKey,
        baseUrl: options?.baseUrl,
        ...common,
    };
}
