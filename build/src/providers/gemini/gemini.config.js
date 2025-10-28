"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGeminiConfig = buildGeminiConfig;
const config_factory_1 = require("../../core/config/config.factory");
function buildGeminiConfig(aiParams, options) {
    const providerDefaults = {
        model: (aiParams.model || 'gemini-2.5-flash').trim(),
        temperature: aiParams.temperature,
        systemText: (options?.systemText || 'You are a senior code reviewer who writes excellent pull request titles and descriptions. Titles must follow Conventional Commits (type(scope): subject) in imperative mood and <=72 chars. Descriptions must be clear, Markdown-formatted, reviewer-friendly. Always output strict JSON as requested.').trim(),
    };
    const common = (0, config_factory_1.buildProviderCommonConfig)(providerDefaults);
    return {
        apiKey: aiParams.apiKey,
        ...common,
    };
}
