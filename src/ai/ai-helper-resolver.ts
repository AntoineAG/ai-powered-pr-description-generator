import GeminiAIHelper from "./gemini-ai-helper";
import OpenAIHelper from "./open-ai-helper";
import { AIHelperInterface, AIHelperParams } from "./types";

const aiHelperResolver = (aiHelperParams: AIHelperParams): AIHelperInterface => { 
    const { aiName, model, temperature } = aiHelperParams;
    console.log('[AI] Resolver ->', { aiName, model, temperature });
    switch(aiName) {
        case 'open-ai':
        case 'openai':
            return new OpenAIHelper(aiHelperParams);
        case 'gemini':
        default:
            return new GeminiAIHelper(aiHelperParams);
    }
}

export default aiHelperResolver;
