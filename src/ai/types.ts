export interface AIHelperInterface {
  createPullRequestDescription: (diffOutput: string, prompt: string) => Promise<string>
}

export interface AIHelperParams {
  aiName: string,
  apiKey: string,
  temperature: number,
  model?: string,
}

// Minimal logger interface to keep helpers testable and provider-agnostic
export interface Logger {
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
  // After this many consecutive 503s, switch model if possible
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

// Strong, constructor-only configuration for Gemini helper
export interface GeminiConfig extends ProviderCommonConfig {
  apiKey: string;
}

// Strong, constructor-only configuration for OpenAI helper
export interface OpenAIConfig extends ProviderCommonConfig {
  apiKey: string;
  baseUrl?: string;
}

export type ProviderName = 'gemini' | 'openai';
