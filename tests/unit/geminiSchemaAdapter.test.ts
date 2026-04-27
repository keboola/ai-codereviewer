import { SchemaType } from '@google/generative-ai';
import { toGeminiSchema } from '../../src/providers/geminiSchemaAdapter';
import { reviewResponseSchema } from '../../src/prompts';

describe('toGeminiSchema', () => {
  it('maps the shared review schema to Gemini SchemaType', () => {
    const out = toGeminiSchema(reviewResponseSchema as any) as any;
    expect(out.type).toBe(SchemaType.OBJECT);
    expect(out.required).toEqual(['summary', 'comments', 'suggestedAction', 'confidence']);
    expect(out.properties.summary.type).toBe(SchemaType.STRING);
    expect(out.properties.confidence.type).toBe(SchemaType.NUMBER);
    expect(out.properties.comments.type).toBe(SchemaType.ARRAY);
    expect(out.properties.comments.items.type).toBe(SchemaType.OBJECT);
    expect(out.properties.comments.items.properties.line.type).toBe(SchemaType.INTEGER);
    expect(out.properties.comments.items.properties.severity.enum)
      .toEqual(['blocker', 'major', 'minor', 'nit']);
    expect(out.properties.suggestedAction.enum)
      .toEqual(['approve', 'request_changes', 'comment']);
  });

  it('drops unsupported JSON Schema keys (additionalProperties, minimum, etc.)', () => {
    const out = toGeminiSchema({
      type: 'object',
      additionalProperties: false,
      properties: { n: { type: 'integer', minimum: 0, maximum: 100 } },
      required: ['n'],
    } as any) as any;
    expect(out.additionalProperties).toBeUndefined();
    expect(out.properties.n.minimum).toBeUndefined();
    expect(out.properties.n.maximum).toBeUndefined();
    expect(out.properties.n.type).toBe(SchemaType.INTEGER);
  });

  it('throws on unknown type', () => {
    expect(() => toGeminiSchema({ type: 'tuple' } as any)).toThrow(/unsupported/i);
  });
});
