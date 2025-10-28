"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGeminiConfig = buildGeminiConfig;
const config_factory_1 = require("../../core/config/config.factory");
function buildGeminiConfig(aiParams, options) {
    const providerDefaults = {
        model: (aiParams.model || 'gemini-2.5-flash').trim(),
        temperature: aiParams.temperature,
        systemText: (options?.systemText || 'You are very good at reviewing code and can generate pull request descriptions.').trim(),
    };
    const common = (0, config_factory_1.buildProviderCommonConfig)(providerDefaults);
    return {
        apiKey: aiParams.apiKey,
        ...common,
    };
}
