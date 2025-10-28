import * as core from '@actions/core';
import { buildGeminiConfig } from '../providers/gemini/gemini.config';
import GeminiAIHelper from '../providers/gemini/gemini.helper';
import { buildOpenAIConfig } from '../providers/openai/openai.config';
import OpenAIHelper from '../providers/openai/openai.helper';
import { AIHelperInterface, AIHelperParams, Logger } from './types';

const aiHelperResolver = (aiHelperParams: AIHelperParams): AIHelperInterface => {
  const { aiName, model, temperature } = aiHelperParams;
  core.info(`[AI] Resolver -> provider=${aiName}, model=${model}, temperature=${temperature}`);

  const logger: Logger = {
    startGroup: (msg: string) => core.startGroup(msg),
    endGroup: () => core.endGroup(),
    info: (msg: string) => core.info(msg),
    warn: (msg: string) => core.warning(msg),
    error: (msg: string) => core.error(msg),
    debug: (msg: string) => core.info(msg),
  };

  switch (aiName?.toLowerCase()) {
    case 'open-ai':
    case 'openai': {
      const config = buildOpenAIConfig(aiHelperParams);
      return new OpenAIHelper({ config, logger });
    }
    case 'gemini':
    default: {
      const config = buildGeminiConfig(aiHelperParams);
      return new GeminiAIHelper({ config, logger });
    }
  }
};

export default aiHelperResolver;
