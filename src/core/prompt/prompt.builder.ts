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

export interface UnifiedPRPromptParams {
  diff: string;
  currentTitle?: string;
  creator?: string;
}

/**
 * Builds a unified prompt asking the model to produce both a PR title and description
 * in a strict JSON format. The prompt merges previous title/description guidance
 * while remaining provider-agnostic.
 */
export function buildUnifiedPRPrompt(params: UnifiedPRPromptParams): string {
  const { diff, currentTitle, creator } = params;
  const allowedEmojis = '🚀 🎉 👍 👏 🔥';
  return (
    `You are helping write a precise, concise Pull Request title and a clear, reviewer-friendly description.\n\n` +
    `Output format:\n` +
    `- Output STRICT JSON only (no code fences, no commentary).\n` +
    `- Fields:\n` +
    `  {\n` +
    `    "title": {\n` +
    `      "subject": string,\n` +
    `      "type": string | null,\n` +
    `      "scope": string | null,\n` +
    `      "conventional": string\n` +
    `    },\n` +
    `    "description": string\n` +
    `  }\n\n` +
    `Title rules:\n` +
    `- Write in Conventional Commit format: type(scope): subject.\n` +
    `- Imperative mood, present tense; no trailing punctuation; no quotes; no emojis.\n` +
    `- 6–12 words; maximum 72 characters.\n` +
    `- If a current title exists, improve it slightly if useful.\n\n` +
    `Description rules:\n` +
    `- Markdown format. Begin with a subtitle: "## What this PR does?"\n` +
    `- Provide a simple description of the changes.\n` +
    `- Numbered list of key changes. Do not paste the raw diff.\n` +
    `- Keep it simple and reviewer-friendly.\n` +
    `- Avoid code snippets or images.\n` +
    `- Add some fun with emojis from [${allowedEmojis}] only: at most one emoji per item, and at most 3 total.\n` +
    (creator ? `- Thank **${creator}** for the contribution! 🎉\n` : '') +
    `\n` +
    `Context:\n` +
    (currentTitle ? `Current title: ${currentTitle}\n` : '') +
    `Diff:\n${diff}`
  );
}
