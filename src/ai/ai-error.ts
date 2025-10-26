export interface AIErrorMeta {
  provider: 'Gemini' | 'OpenAI' | string;
  model?: string;
  attempt?: number;
  statusCode?: number;
  retryCount?: number;
}

export class AIError extends Error {
  readonly meta: AIErrorMeta;
  readonly causeErr?: unknown;
  constructor(message: string, meta: AIErrorMeta, cause?: unknown) {
    super(message);
    this.name = 'AIError';
    this.meta = meta;
    this.causeErr = cause;
  }
  static wrap(message: string, meta: AIErrorMeta, cause?: unknown): AIError {
    return new AIError(message, meta, cause);
  }
}

