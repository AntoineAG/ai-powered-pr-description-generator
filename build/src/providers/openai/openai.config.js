"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildOpenAIConfig = buildOpenAIConfig;
const config_factory_1 = require("../../core/config/config.factory");
function buildOpenAIConfig(aiParams, options) {
    const providerDefaults = {
        model: (aiParams.model || 'gpt-4.1').trim(),
        temperature: aiParams.temperature,
        systemText: (options?.systemText || 'You are a senior code reviewer who writes excellent pull request titles and descriptions. Titles must follow Conventional Commits (type(scope): subject) in imperative mood and <=72 chars. Descriptions must be clear, Markdown-formatted, reviewer-friendly. Always output strict JSON as requested.').trim(),
    };
    const common = (0, config_factory_1.buildProviderCommonConfig)({ ...providerDefaults, retry: { modelLadder: options?.modelLadder } });
    return {
        apiKey: aiParams.apiKey,
        baseUrl: options?.baseUrl,
        ...common,
    };
}
