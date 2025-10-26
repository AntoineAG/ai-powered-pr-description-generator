import { AIHelperParams, GeminiConfig, OpenAIConfig, ProviderName, ProviderCommonConfig, RetryConfig } from './types';

export const DEFAULT_MAX_OUTPUT_TOKENS = 1536;
export const MIN_MAX_OUTPUT_TOKENS = 768;

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 8,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  jitterMs: 250,
  consecutive503ToSwitch: 10,
  modelLadder: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-flash'],
};

export function clampMaxOutputTokens(value: number | undefined): number {
  if (!Number.isFinite(value as number) || (value as number) <= 0) return DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.max(MIN_MAX_OUTPUT_TOKENS, Math.floor(value as number));
}

export function readIntEnv(name: string, fallback?: number): number | undefined {
  const raw = (process.env[name] || '').trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function buildRetryConfigFromEnv(base?: Partial<RetryConfig>): RetryConfig {
  return {
    maxAttempts: readIntEnv('RETRY_MAX_ATTEMPTS', base?.maxAttempts) ?? DEFAULT_RETRY_CONFIG.maxAttempts,
    baseDelayMs: readIntEnv('RETRY_BASE_DELAY_MS', base?.baseDelayMs) ?? DEFAULT_RETRY_CONFIG.baseDelayMs,
    maxDelayMs: readIntEnv('RETRY_MAX_DELAY_MS', base?.maxDelayMs) ?? DEFAULT_RETRY_CONFIG.maxDelayMs,
    jitterMs: readIntEnv('RETRY_JITTER_MS', base?.jitterMs) ?? DEFAULT_RETRY_CONFIG.jitterMs,
    consecutive503ToSwitch: readIntEnv('RETRY_CONSEC_503_SWITCH', base?.consecutive503ToSwitch) ?? DEFAULT_RETRY_CONFIG.consecutive503ToSwitch,
    modelLadder: base?.modelLadder ?? DEFAULT_RETRY_CONFIG.modelLadder,
  };
}

export function buildProviderCommonConfig(params: { model: string; temperature: number; systemText: string; maxOutputTokens?: number; retry?: Partial<RetryConfig> }): ProviderCommonConfig {
  const maxOutputTokensEnv = clampMaxOutputTokens(readIntEnv('MAX_OUTPUT_TOKENS', params.maxOutputTokens));
  return {
    model: params.model,
    temperature: params.temperature,
    maxOutputTokens: maxOutputTokensEnv,
    systemText: params.systemText,
    retry: buildRetryConfigFromEnv(params.retry),
  };
}

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

