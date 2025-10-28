"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROMPT_PREVIEW_LIMIT = void 0;
exports.previewText = previewText;
exports.buildUserPromptText = buildUserPromptText;
exports.buildContinuationParts = buildContinuationParts;
exports.buildGenerateRequest = buildGenerateRequest;
exports.buildUnifiedPRPrompt = buildUnifiedPRPrompt;
const generative_ai_1 = require("@google/generative-ai");
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
    // Enforce JSON mode with an explicit schema for the unified object
    const schema = {
        type: generative_ai_1.SchemaType.OBJECT,
        properties: {
            title: {
                type: generative_ai_1.SchemaType.OBJECT,
                properties: {
                    subject: { type: generative_ai_1.SchemaType.STRING },
                    type: { type: generative_ai_1.SchemaType.STRING, nullable: true },
                    scope: { type: generative_ai_1.SchemaType.STRING, nullable: true },
                    conventional: { type: generative_ai_1.SchemaType.STRING },
                },
                required: ['subject', 'conventional'],
            },
            description: { type: generative_ai_1.SchemaType.STRING },
        },
        required: ['title', 'description'],
    };
    return {
        contents: [{ role: 'user', parts: [{ text: params.userText }] }],
        generationConfig: {
            temperature: params.temperature,
            maxOutputTokens: params.maxOutputTokens,
            responseMimeType: 'application/json',
            responseSchema: schema,
        },
    };
}
/**
 * Builds a unified prompt asking the model to produce both a PR title and description
 * in a strict JSON format. The prompt merges previous title/description guidance
 * while remaining provider-agnostic.
 */
function buildUnifiedPRPrompt(params) {
    const { diff, currentTitle, creator } = params;
    const allowedEmojis = '🚀 🎉 👍 👏 🔥';
    return (`You are helping write a precise, concise Pull Request title and a clear, reviewer-friendly description.\n\n` +
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
        `- Use max 5 items; each ≤ 12 words; total ≤ 180 words.\n` +
        (creator ? `- Thank **${creator}** for the contribution! 🎉\n` : '') +
        `\n` +
        `Context:\n` +
        (currentTitle ? `Current title: ${currentTitle}\n` : '') +
        `Diff:\n${diff}`);
}
