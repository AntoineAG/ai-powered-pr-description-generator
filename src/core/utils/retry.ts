import { Logger, RetryConfig } from '../../core/types';

export interface RetryOptions {
  logger: Logger;
  provider: 'Gemini' | 'OpenAI';
  initialModel: string;
  retry: RetryConfig;
}

export interface RetryOutcome<T> {
  value: T;
  modelUsed: string;
  attempts: number;
  elapsedMs: number;
}

export interface RetryClassifier {
  isRetryable: (e: unknown) => boolean;
  isOverloaded: (e: unknown) => boolean; // for 503-like
  status: (e: unknown) => number | undefined;
  message: (e: unknown) => string;
}

export const defaultRetryClassifier: RetryClassifier = {
  isRetryable: (e: any) => {
    const status = typeof e?.status === 'number' ? e.status : undefined;
    const msg = e?.message ? String(e.message) : String(e);
    return status === 429 || status === 503 || /\b(429|503)\b/.test(msg) || /temporar(il)?y|unavailable|overload/i.test(msg);
  },
  isOverloaded: (e: any) => {
    const status = typeof e?.status === 'number' ? e.status : undefined;
    const msg = e?.message ? String(e.message) : String(e);
    return status === 503 || /\b503\b/.test(msg) || /unavailable|overload/i.test(msg);
  },
  status: (e: any) => (typeof e?.status === 'number' ? e.status : undefined),
  message: (e: any) => (e?.message ? String(e.message) : String(e)),
};

export async function generateWithRetry<T>(
  task: (modelName: string) => Promise<T>,
  options: RetryOptions,
  classifier: RetryClassifier = defaultRetryClassifier,
): Promise<RetryOutcome<T>> {
  const { logger, provider, retry } = options;
  const ladder = [options.initialModel, ...(retry.modelLadder || []).filter(m => m !== options.initialModel)];
  let currentIdx = 0;
  let currentModel = ladder[currentIdx];
  let consecutive503 = 0;
  const started = Date.now();

  for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
    const delay = Math.min(retry.baseDelayMs * Math.pow(2, attempt - 1), retry.maxDelayMs) + Math.floor(Math.random() * retry.jitterMs);
    logger.info(`[AI][${provider}] 🔁 Attempt ${attempt} model=${currentModel}`);
    try {
      const value = await task(currentModel);
      const elapsed = Date.now() - started;
      logger.info(`[AI][${provider}] ✅ success attempt=${attempt} model=${currentModel} elapsedMs=${elapsed}`);
      return { value, modelUsed: currentModel, attempts: attempt, elapsedMs: elapsed };
    } catch (err) {
      const status = classifier.status(err);
      const msg = classifier.message(err);
      const overloaded = classifier.isOverloaded(err);
      const retryable = classifier.isRetryable(err);
      if (overloaded) consecutive503++; else consecutive503 = 0;

      if (retryable) {
        if (overloaded && retry.consecutive503ToSwitch && consecutive503 >= retry.consecutive503ToSwitch && currentIdx < ladder.length - 1) {
          const next = ladder[++currentIdx];
          logger.warn(`[AI][${provider}] ⚠️ persistent 503; switching model ${currentModel} -> ${next}`);
          currentModel = next;
        }
        logger.warn(`[AI][${provider}] ⚠️ retryable error status=${status ?? 'n/a'} message=${msg}`);
        logger.warn(`[AI][${provider}] 🔁 will retry attempt=${attempt + 1} in ${delay}ms`);
        if (attempt >= retry.maxAttempts) throw err;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      logger.error(`[AI][${provider}] ❌ non-retryable error attempt=${attempt} status=${status ?? 'n/a'} message=${msg}`);
      throw err;
    }
  }
  const elapsed = Date.now() - started;
  throw new Error(`[AI][${provider}] Exhausted retry attempts after ${elapsed}ms`);
}

