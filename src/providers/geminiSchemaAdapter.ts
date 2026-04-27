import { SchemaType } from '@google/generative-ai';

/**
 * Convert a (subset of) JSON Schema to the Gemini SDK's `Schema` shape.
 *
 * Gemini uses its own `SchemaType` enum (OBJECT, ARRAY, STRING, INTEGER,
 * NUMBER, BOOLEAN) instead of JSON Schema's string `type` field, but the
 * surrounding shape is otherwise compatible (`properties`, `required`,
 * `items`, `enum`).
 *
 * Supported subset (everything used by reviewResponseSchema):
 *   - "object" with `properties` and `required`
 *   - "array" with `items`
 *   - "string" with optional `enum`
 *   - "integer", "number", "boolean"
 *
 * Unsupported keys (`additionalProperties`, `minimum`, `maximum`, etc.)
 * are silently dropped — Gemini doesn't honor them and including them
 * provokes the SDK's input validator.
 */
type JsonSchemaNode = {
  type?: string;
  properties?: Record<string, JsonSchemaNode>;
  required?: readonly string[];
  items?: JsonSchemaNode;
  enum?: readonly string[];
  [key: string]: unknown;
};

const TYPE_MAP: Record<string, SchemaType> = {
  object: SchemaType.OBJECT,
  array: SchemaType.ARRAY,
  string: SchemaType.STRING,
  integer: SchemaType.INTEGER,
  number: SchemaType.NUMBER,
  boolean: SchemaType.BOOLEAN,
};

export function toGeminiSchema(node: JsonSchemaNode): Record<string, unknown> {
  const jsonType = node.type;
  if (!jsonType || !(jsonType in TYPE_MAP)) {
    throw new Error(`toGeminiSchema: unsupported or missing JSON Schema type '${jsonType}'`);
  }

  const out: Record<string, unknown> = { type: TYPE_MAP[jsonType] };

  if (jsonType === 'object') {
    if (node.properties) {
      const props: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node.properties)) {
        props[key] = toGeminiSchema(child);
      }
      out.properties = props;
    }
    if (node.required) {
      out.required = [...node.required];
    }
  } else if (jsonType === 'array') {
    if (node.items) {
      out.items = toGeminiSchema(node.items);
    }
  } else if (jsonType === 'string' && node.enum) {
    out.enum = [...node.enum];
  }

  return out;
}
