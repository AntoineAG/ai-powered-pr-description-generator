import { Content, GenerateContentRequest, Part } from '@google/generative-ai';
import { UnifiedPRSchema } from '../json/schema';
import type { PromptLimits } from '../types';
import { jsonModeConfig } from './json.config';

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
    generationConfig: jsonModeConfig({ schema: UnifiedPRSchema, temperature: params.temperature, maxOutputTokens: params.maxOutputTokens }),
  };
}

export interface UnifiedPRPromptParams {
  diff: string;
  currentTitle?: string;
  creator?: string;
  limits: PromptLimits;
}

/** Builds a unified prompt for PR title + description in strict JSON mode. */
export function buildUnifiedPRPrompt(params: UnifiedPRPromptParams): string {
  const { diff, currentTitle, creator, limits } = params;
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
    `- 6–12 words; maximum ${limits.titleMaxLen} characters.`,
    '- If a current title exists, improve it slightly if useful.',
    '',
    'Description rules:',
    '- Markdown format. Begin with a subtitle: "## What this PR does?\n"',
    '- Provide a simple description of the changes.',
    '- Numbered list of key changes. Do not paste the raw diff.',
    '- Keep it simple and reviewer-friendly.',
    '- Avoid code snippets or images.',
    `- Add some fun with emojis from [${(limits.allowedEmojis || []).join(' ')}] only: at most one emoji per item, and at most ${limits.descMaxItems} total.`,
    `- Use max ${limits.descMaxItems} items; each ≤ ${limits.descMaxWordsPerItem} words; total ≤ ${limits.descMaxTotalWords} words.`,
  ];
  if (creator) lines.push(`- Thank **${creator}** for the contribution! 🎉`);
  lines.push('', 'Context:');
  if (currentTitle) lines.push(`Current title: ${currentTitle}`);
  lines.push(`Diff:\n${diff}`);
  return lines.join('\n');
}
