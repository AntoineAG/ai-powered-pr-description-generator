"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TailContinuationSchema = exports.UnifiedPRSchema = void 0;
const generative_ai_1 = require("@google/generative-ai");
// Unified JSON response schema for PR title + description
exports.UnifiedPRSchema = {
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
// Tail-only continuation schema
exports.TailContinuationSchema = {
    type: generative_ai_1.SchemaType.OBJECT,
    properties: { description_tail: { type: generative_ai_1.SchemaType.STRING } },
    required: ['description_tail'],
};
