import { Content, GenerateContentRequest, Part } from '@google/generative-ai';
import { GITMOJI_LEGEND } from '../gitmoji-legend';
import { UnifiedPRSchema } from '../json/schema';
import type { PRContentRules } from '../types';
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
  rules: PRContentRules;
}

/** Builds a unified prompt for PR title + description in strict JSON mode. */
export function buildUnifiedPRPrompt(params: UnifiedPRPromptParams): string {
  const { diff, currentTitle, creator, rules } = params;
  const titleEmojiList = (rules.titleEmojis || []).join(' ');
  const descEmojiList = (rules.descriptionEmojis || []).join(' ');
  const legendKeys = Array.from(new Set([...(rules.titleEmojis || []), ...(rules.descriptionEmojis || [])]));
  const legendLines: string[] = [];
  for (const e of legendKeys) {
    const meaning = (GITMOJI_LEGEND as Record<string, string>)[e];
    if (meaning) legendLines.push(`- ${e} = ${meaning}`);
  }
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
    '- Imperative mood, present tense; no trailing punctuation; no quotes.',
    `- 6–12 words; maximum ${rules.titleMaxLen} characters.`,
    rules.allowTitleEmojis
      ? `- The title MUST include exactly one emoji at the very start, chosen from: [${titleEmojiList}]. Format: <emoji> type(scope): subject.`
      : '- The title MUST NOT include any emoji.',
    '- If a current title exists, improve it slightly if useful.',
    '',
    'Description rules:',
    '- Markdown format. Begin with a subtitle: "## What this PR does?\n"',
    '- Provide a simple description of the changes.',
    '- Numbered list of key changes. Do not paste the raw diff.',
    '- Keep it simple and reviewer-friendly.',
    '- Avoid code snippets or images.',
    rules.allowDescriptionEmojis
      ? `- Items MAY include at most 1 emoji per item (max 3 total across the description), from: [${descEmojiList}].`
      : '- Do NOT use any emoji in the description.',
    `- Use max ${rules.descMaxItems} items; each ≤ ${rules.descMaxWordsPerItem} words; total ≤ ${rules.descMaxTotalWords} words.`,
  ];
  if (creator) lines.push(`- Thank **${creator}** for the contribution! 🎉`);
  if (legendLines.length > 0) {
    lines.push('', 'Emoji legend (use to choose the most fitting one):');
    lines.push(...legendLines);
  }
  lines.push('', 'Context:');
  if (currentTitle) lines.push(`Current title: ${currentTitle}`);
  lines.push(`Diff:\n${diff}`);
  return lines.join('\n');
}
