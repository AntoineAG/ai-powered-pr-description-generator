"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROMPT_PREVIEW_LIMIT = void 0;
exports.previewText = previewText;
exports.buildUserPromptText = buildUserPromptText;
exports.buildContinuationParts = buildContinuationParts;
exports.buildGenerateRequest = buildGenerateRequest;
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
        generationConfig: { temperature: params.temperature, maxOutputTokens: params.maxOutputTokens },
    };
}
