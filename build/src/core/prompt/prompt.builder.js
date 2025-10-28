"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DESC_MAX_WORDS = exports.DESC_ITEM_MAX_WORDS = exports.DESC_MAX_ITEMS = exports.ALLOWED_EMOJIS = exports.PROMPT_PREVIEW_LIMIT = void 0;
exports.previewText = previewText;
exports.buildUserPromptText = buildUserPromptText;
exports.buildContinuationParts = buildContinuationParts;
exports.buildGenerateRequest = buildGenerateRequest;
exports.buildUnifiedPRPrompt = buildUnifiedPRPrompt;
const json_config_1 = require("./json.config");
const schema_1 = require("../json/schema");
exports.PROMPT_PREVIEW_LIMIT = 2000;
exports.ALLOWED_EMOJIS = '🚀 🎉 👍 👏 🔥';
exports.DESC_MAX_ITEMS = 5;
exports.DESC_ITEM_MAX_WORDS = 12;
exports.DESC_MAX_WORDS = 180;
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
    const { diff, currentTitle, creator } = params;
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
        '- Imperative mood, present tense; no trailing punctuation; no quotes; no emojis.',
        '- 6–12 words; maximum 72 characters.',
        '- If a current title exists, improve it slightly if useful.',
        '',
        'Description rules:',
        '- Markdown format. Begin with a subtitle: "## What this PR does?"',
        '- Provide a simple description of the changes.',
        '- Numbered list of key changes. Do not paste the raw diff.',
        '- Keep it simple and reviewer-friendly.',
        '- Avoid code snippets or images.',
        `- Add some fun with emojis from [${exports.ALLOWED_EMOJIS}] only: at most one emoji per item, and at most 3 total.`,
        `- Use max ${exports.DESC_MAX_ITEMS} items; each ≤ ${exports.DESC_ITEM_MAX_WORDS} words; total ≤ ${exports.DESC_MAX_WORDS} words.`,
    ];
    if (creator)
        lines.push(`- Thank **${creator}** for the contribution! 🎉`);
    lines.push('', 'Context:');
    if (currentTitle)
        lines.push(`Current title: ${currentTitle}`);
    lines.push(`Diff:\n${diff}`);
    return lines.join('\n');
}
