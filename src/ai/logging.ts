import { Logger } from './types';

export function group(logger: Logger, title: string, fn: () => Promise<void> | void): Promise<void> | void {
  logger.info(`::group::${title}`);
  try {
    const r = fn();
    if (r && typeof (r as Promise<void>).then === 'function') {
      return (r as Promise<void>).finally(() => logger.info('::endgroup::'));
    }
  } finally {
    logger.info('::endgroup::');
  }
}

export const prefix = (provider: 'Gemini' | 'OpenAI') => `[AI][${provider}]`;

