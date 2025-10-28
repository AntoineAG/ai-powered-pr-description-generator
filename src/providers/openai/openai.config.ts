import { OpenAIConfig, AIHelperParams } from '../../core/types';
import { buildProviderCommonConfig } from '../../core/config/config.factory';

export function buildOpenAIConfig(aiParams: AIHelperParams, options?: { systemText?: string; baseUrl?: string; modelLadder?: string[] }): OpenAIConfig {
  const providerDefaults = {
    model: (aiParams.model || 'gpt-4.1').trim(),
    temperature: aiParams.temperature,
    systemText: (options?.systemText || 'You are a senior code reviewer who writes excellent pull request titles and descriptions. Titles must follow Conventional Commits (type(scope): subject) in imperative mood and <=72 chars. Descriptions must be clear, Markdown-formatted, reviewer-friendly. Always output strict JSON as requested.').trim(),
  };
  const common = buildProviderCommonConfig({ ...providerDefaults, retry: { modelLadder: options?.modelLadder } });
  return {
    apiKey: aiParams.apiKey,
    baseUrl: options?.baseUrl,
    ...common,
  };
}
