export interface AIHelperInterface {
  createPullRequestDescription: (diffOutput: string, prompt: string) => Promise<string>
}

export interface AIHelperParams {
  aiName: string,
  apiKey: string,
  temperature: number,
  model?: string,
}

export interface Logger {
  startGroup: (msg: string) => void,
  endGroup: () => void,
  info: (msg: string) => void,
  warn: (msg: string) => void,
  error: (msg: string) => void,
  debug?: (msg: string) => void,
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
  consecutive503ToSwitch?: number;
  modelLadder?: string[];
}

export interface ProviderCommonConfig {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  systemText: string;
  retry: RetryConfig;
}

export interface GeminiConfig extends ProviderCommonConfig {
  apiKey: string;
}

export interface OpenAIConfig extends ProviderCommonConfig {
  apiKey: string;
  baseUrl?: string;
}

export type ProviderName = 'gemini' | 'openai';

