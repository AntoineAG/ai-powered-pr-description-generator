import { Content, GenerateContentRequest, Part } from '@google/generative-ai';

export const PROMPT_PREVIEW_LIMIT = 2000;

export function previewText(text: string, limit: number = PROMPT_PREVIEW_LIMIT): string {
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit)}[...]` : text;
}

export function buildUserPromptText(systemText: string, prompt: string, supportsSystemInstruction: boolean): string {
  return supportsSystemInstruction ? prompt : `${systemText}\n\n${prompt}`;
}

export function buildContinuationParts(previousOutput: string, prompt: string): Content[] {
  return [
    { role: 'user', parts: [{ text: prompt }] as Part[] },
    { role: 'model', parts: [{ text: previousOutput }] as Part[] },
    { role: 'user', parts: [{ text: 'Continue from where you left off. Do not repeat earlier content. Keep the same structure and style.' }] as Part[] },
  ];
}

export function buildGenerateRequest(params: { userText: string; temperature: number; maxOutputTokens: number }): GenerateContentRequest {
  return {
    contents: [ { role: 'user', parts: [{ text: params.userText }] } ],
    generationConfig: { temperature: params.temperature, maxOutputTokens: params.maxOutputTokens },
  };
}

