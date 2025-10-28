import * as core from '@actions/core';
import { Logger } from '../types';

export const actionsLogger: Logger = {
  startGroup: (msg: string) => core.startGroup(msg),
  endGroup: () => core.endGroup(),
  info: (msg: string) => core.info(msg),
  warn: (msg: string) => core.warning(msg),
  error: (msg: string) => core.error(msg),
  debug: (msg: string) => core.info(msg),
};

export function group(logger: Logger, title: string, fn: () => Promise<void> | void): Promise<void> | void {
  logger.startGroup(title);
  try {
    const r = fn();
    if (r && typeof (r as Promise<void>).then === 'function') {
      return (r as Promise<void>).finally(() => logger.endGroup());
    }
  } finally {
    logger.endGroup();
  }
}

export const prefix = (provider: 'Gemini' | 'OpenAI') => `[AI][${provider}]`;

