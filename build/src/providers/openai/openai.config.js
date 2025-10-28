"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildOpenAIConfig = buildOpenAIConfig;
const config_factory_1 = require("../../core/config/config.factory");
function buildOpenAIConfig(aiParams, options) {
    const providerDefaults = {
        model: (aiParams.model || 'gpt-4.1').trim(),
        temperature: aiParams.temperature,
        systemText: (options?.systemText || 'You are a super assistant, very good at reviewing code, and can generate the best pull request descriptions.').trim(),
    };
    const common = (0, config_factory_1.buildProviderCommonConfig)({ ...providerDefaults, retry: { modelLadder: options?.modelLadder } });
    return {
        apiKey: aiParams.apiKey,
        baseUrl: options?.baseUrl,
        ...common,
    };
}
