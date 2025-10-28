import { OpenAIConfig, AIHelperParams } from '../../core/types';
import { buildProviderCommonConfig } from '../../core/config/config.factory';

export function buildOpenAIConfig(aiParams: AIHelperParams, options?: { systemText?: string; baseUrl?: string; modelLadder?: string[] }): OpenAIConfig {
  const providerDefaults = {
    model: (aiParams.model || 'gpt-4.1').trim(),
    temperature: aiParams.temperature,
    systemText: (options?.systemText || 'You are a super assistant, very good at reviewing code, and can generate the best pull request descriptions.').trim(),
  };
  const common = buildProviderCommonConfig({ ...providerDefaults, retry: { modelLadder: options?.modelLadder } });
  return {
    apiKey: aiParams.apiKey,
    baseUrl: options?.baseUrl,
    ...common,
  };
}

