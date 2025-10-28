import { GeminiConfig, AIHelperParams } from '../../core/types';
import { buildProviderCommonConfig } from '../../core/config/config.factory';

export function buildGeminiConfig(aiParams: AIHelperParams, options?: { systemText?: string }): GeminiConfig {
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

