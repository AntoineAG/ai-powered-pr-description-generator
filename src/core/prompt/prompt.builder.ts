import { Content, GenerateContentRequest, Part } from '@google/generative-ai';
import { UnifiedPRSchema } from '../json/schema';
import { jsonModeConfig } from './json.config';

export const PROMPT_PREVIEW_LIMIT = 2000;
export const ALLOWED_EMOJIS = '🚀 🎉 👍 👏 🔥';
export const DESC_MAX_ITEMS = 5;
export const DESC_ITEM_MAX_WORDS = 25;
export const DESC_MAX_WORDS = 300;

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
    generationConfig: jsonModeConfig({ schema: UnifiedPRSchema, temperature: params.temperature, maxOutputTokens: params.maxOutputTokens }),
  };
}

export interface UnifiedPRPromptParams {
  diff: string;
  currentTitle?: string;
  creator?: string;
}

/** Builds a unified prompt for PR title + description in strict JSON mode. */
export function buildUnifiedPRPrompt(params: UnifiedPRPromptParams): string {
  const { diff, currentTitle, creator } = params;
  const lines: string[] = [
    'You are helping write a precise, concise Pull Request title and a clear, reviewer-friendly description.',
    '',
    'Output format:',
    '- Output STRICT JSON only (no code fences, no commentary).',
    '- Fields:',
    '  {',
    '    "title": {',
    '      "subject": string,',
    '      "type": string | null,',
    '      "scope": string | null,',
    '      "conventional": string',
    '    },',
    '    "description": string',
    '  }',
    '',
    'Title rules:',
    '- Write in Conventional Commit format: type(scope): subject.',
    '- Imperative mood, present tense; no trailing punctuation; no quotes; no emojis.',
    '- 6–12 words; maximum 72 characters.',
    '- If a current title exists, improve it slightly if useful.',
    '',
    'Description rules:',
    '- Markdown format. Begin with a subtitle: "## What this PR does?\n"',
    '- Provide a simple description of the changes.',
    '- Numbered list of key changes. Do not paste the raw diff.',
    '- Keep it simple and reviewer-friendly.',
    '- Avoid code snippets or images.',
    `- Add some fun with emojis from [${ALLOWED_EMOJIS}] only: at most one emoji per item, and at most 3 total.`,
    `- Use max ${DESC_MAX_ITEMS} items; each ≤ ${DESC_ITEM_MAX_WORDS} words; total ≤ ${DESC_MAX_WORDS} words.`,
  ];
  if (creator) lines.push(`- Thank **${creator}** for the contribution! 🎉`);
  lines.push('', 'Context:');
  if (currentTitle) lines.push(`Current title: ${currentTitle}`);
  lines.push(`Diff:\n${diff}`);
  return lines.join('\n');
}

