import { ObjectSchema, SchemaType } from '@google/generative-ai';

// Unified JSON response schema for PR title + description
export const UnifiedPRSchema: ObjectSchema = {
  type: SchemaType.OBJECT,
  properties: {
    title: {
      type: SchemaType.OBJECT,
      properties: {
        subject: { type: SchemaType.STRING },
        type: { type: SchemaType.STRING, nullable: true },
        scope: { type: SchemaType.STRING, nullable: true },
        conventional: { type: SchemaType.STRING },
      },
      required: ['subject', 'conventional'],
    },
    description: { type: SchemaType.STRING },
  },
  required: ['title', 'description'],
};

// Tail-only continuation schema
export const TailContinuationSchema: ObjectSchema = {
  type: SchemaType.OBJECT,
  properties: { description_tail: { type: SchemaType.STRING } },
  required: ['description_tail'],
};

