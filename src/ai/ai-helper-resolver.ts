import * as core from '@actions/core';
import GeminiAIHelper from "./gemini-ai-helper";
import OpenAIHelper from "./open-ai-helper";
import { AIHelperInterface, AIHelperParams, GeminiConfig, Logger } from "./types";

const aiHelperResolver = (aiHelperParams: AIHelperParams): AIHelperInterface => { 
    const { aiName, model, temperature } = aiHelperParams;
    core.info(`[AI] Resolver -> provider=${aiName}, model=${model}, temperature=${temperature}`);
    switch(aiName) {
        case 'open-ai':
        case 'openai':
            return new OpenAIHelper(aiHelperParams);
        case 'gemini':
        default: {
            const modelName = (model || 'gemini-2.5-flash').trim();
            // Default to 1536, clamp env override to >= 768
            const maxTokensEnv = Number.parseInt(process.env.MAX_OUTPUT_TOKENS || '', 10);
            const maxOutputTokens = Number.isFinite(maxTokensEnv) && maxTokensEnv > 0 ? Math.max(768, maxTokensEnv) : 1536;
            const systemText = 'You are very good at reviewing code and can generate pull request descriptions.';
            const config: GeminiConfig = {
                apiKey: aiHelperParams.apiKey,
                model: modelName,
                temperature: aiHelperParams.temperature,
                maxOutputTokens,
                systemText,
            };
            const logger: Logger = {
                info: (msg: string) => core.info(msg),
                warn: (msg: string) => core.warning(msg),
                error: (msg: string) => core.error(msg),
                // Route debug lines to info for better visibility in Actions
                debug: (msg: string) => core.info(msg),
            };
            return new GeminiAIHelper({ config, logger });
        }
    }
}

export default aiHelperResolver;
