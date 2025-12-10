import { buildProviderCommonConfig, readIntEnv } from '../../core/config/config.factory';
import { AIHelperParams, GeminiConfig } from '../../core/types';

export function buildGeminiConfig(aiParams: AIHelperParams, options?: { systemText?: string }): GeminiConfig {
  const providerDefaults = {
    model: (aiParams.model || 'gemini-2.5-flash').trim(),
    temperature: aiParams.temperature,
    systemText: (options?.systemText || 'You are a senior code reviewer who writes excellent pull request titles and descriptions. Titles must follow Conventional Commits (type(scope): subject) in imperative mood and <=72 chars. Descriptions must be clear, Markdown-formatted, reviewer-friendly. Always output strict JSON as requested.').trim(),
  };
  // Allow a Gemini-specific override via GEMINI_MAX_OUTPUT_TOKENS, with
  // global MAX_OUTPUT_TOKENS still supported by buildProviderCommonConfig.
  const geminiMaxOutputTokens = readIntEnv('GEMINI_MAX_OUTPUT_TOKENS');
  const common = buildProviderCommonConfig({ ...providerDefaults, maxOutputTokens: geminiMaxOutputTokens });
  return {
    apiKey: aiParams.apiKey,
    ...common,
  };
}
