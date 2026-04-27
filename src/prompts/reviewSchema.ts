/**
 * JSON Schema for the review response. Used by providers that support
 * structured outputs (OpenAI json_schema, Gemini responseSchema) to
 * eliminate parse-failure handling.
 *
 * Field names match the ON-WIRE contract the prompt teaches the model
 * ("comments", "suggestedAction"), not the internal TypeScript shape
 * ("lineComments"). The provider parsers already do this rename.
 */
export const reviewResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'comments', 'suggestedAction', 'confidence'],
  properties: {
    summary: { type: 'string' },
    comments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'line', 'comment', 'severity', 'category'],
        properties: {
          path: { type: 'string' },
          line: { type: 'integer', minimum: 0 },
          comment: { type: 'string' },
          severity: {
            type: 'string',
            enum: ['blocker', 'major', 'minor', 'nit'],
          },
          category: {
            type: 'string',
            enum: ['security', 'bug', 'performance', 'maintainability', 'style', 'docs', 'test', 'other'],
          },
        },
      },
    },
    suggestedAction: {
      type: 'string',
      enum: ['approve', 'request_changes', 'comment'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
  },
} as const;
