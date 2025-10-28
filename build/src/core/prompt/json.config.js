"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jsonModeConfig = jsonModeConfig;
function jsonModeConfig(params) {
    return {
        temperature: params.temperature,
        maxOutputTokens: params.maxOutputTokens,
        responseMimeType: 'application/json',
        responseSchema: params.schema,
    };
}
