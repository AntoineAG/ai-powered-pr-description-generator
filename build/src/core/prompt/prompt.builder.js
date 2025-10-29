"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROMPT_PREVIEW_LIMIT = void 0;
exports.previewText = previewText;
exports.buildUserPromptText = buildUserPromptText;
exports.buildContinuationParts = buildContinuationParts;
exports.buildGenerateRequest = buildGenerateRequest;
exports.buildUnifiedPRPrompt = buildUnifiedPRPrompt;
const gitmoji_legend_1 = require("../gitmoji-legend");
const schema_1 = require("../json/schema");
const json_config_1 = require("./json.config");
exports.PROMPT_PREVIEW_LIMIT = 2000;
function previewText(text, limit = exports.PROMPT_PREVIEW_LIMIT) {
    if (!text)
        return '';
    return text.length > limit ? `${text.slice(0, limit)}[...]` : text;
}
function buildUserPromptText(systemText, prompt, supportsSystemInstruction) {
    return supportsSystemInstruction ? prompt : `${systemText}\n\n${prompt}`;
}
function buildContinuationParts(previousOutput, prompt) {
    return [
        { role: 'user', parts: [{ text: prompt }] },
        { role: 'model', parts: [{ text: previousOutput }] },
        { role: 'user', parts: [{ text: 'Continue from where you left off. Do not repeat earlier content. Keep the same structure and style.' }] },
    ];
}
function buildGenerateRequest(params) {
    return {
        contents: [{ role: 'user', parts: [{ text: params.userText }] }],
        generationConfig: (0, json_config_1.jsonModeConfig)({ schema: schema_1.UnifiedPRSchema, temperature: params.temperature, maxOutputTokens: params.maxOutputTokens }),
    };
}
/** Builds a unified prompt for PR title + description in strict JSON mode. */
function buildUnifiedPRPrompt(params) {
    const { diff, currentTitle, creator, rules } = params;
    const titleEmojiList = (rules.titleEmojis || []).join(' ');
    const descEmojiList = (rules.descriptionEmojis || []).join(' ');
    const legendKeys = Array.from(new Set([...(rules.titleEmojis || []), ...(rules.descriptionEmojis || [])]));
    const legendLines = [];
    for (const e of legendKeys) {
        const meaning = gitmoji_legend_1.GITMOJI_LEGEND[e];
        if (meaning)
            legendLines.push(`- ${e} = ${meaning}`);
    }
    const lines = [
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
    if (legendLines.length > 0) {
        lines.push('', 'Emoji legend (use to choose the most fitting one):');
        lines.push(...legendLines);
    }
    if (creator)
        lines.push(`- Thank **${creator}** for the contribution! 🎉`);
    lines.push('', 'Context:');
    if (currentTitle)
        lines.push(`Current title: ${currentTitle}`);
    lines.push(`Diff:\n${diff}`);
    return lines.join('\n');
}
