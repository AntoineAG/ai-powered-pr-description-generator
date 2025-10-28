import { buildProviderCommonConfig } from '../../core/config/config.factory';
import { AIHelperParams, GeminiConfig } from '../../core/types';

export function buildGeminiConfig(aiParams: AIHelperParams, options?: { systemText?: string }): GeminiConfig {
  const providerDefaults = {
    model: (aiParams.model || 'gemini-2.5-flash').trim(),
    temperature: aiParams.temperature,
    systemText: (options?.systemText || 'You are a senior code reviewer who writes excellent pull request titles and descriptions. Titles must follow Conventional Commits (type(scope): subject) in imperative mood and <=72 chars. Descriptions must be clear, Markdown-formatted, reviewer-friendly. Always output strict JSON as requested.').trim(),
  };
  const common = buildProviderCommonConfig(providerDefaults);
  return {
    apiKey: aiParams.apiKey,
    ...common,
  };
}
