import { GenerationConfig, ObjectSchema } from '@google/generative-ai';

export function jsonModeConfig(params: { schema: ObjectSchema; temperature: number; maxOutputTokens: number }): GenerationConfig {
  return {
    temperature: params.temperature,
    maxOutputTokens: params.maxOutputTokens,
    responseMimeType: 'application/json',
    responseSchema: params.schema,
  };
}

