/**
 * JSON Schema Validator for Structured Output
 *
 * Validates LLM responses against JSON schemas to ensure reliable tool calling
 * and structured output. Supports retry logic and fallback parsing.
 */

import { EventEmitter } from 'events';
import { logger } from './logger.js';

// ============================================================================
// Types
// ============================================================================

export interface JSONSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  properties?: Record<string, JSONSchemaProperty>;
  items?: JSONSchemaProperty;
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  additionalProperties?: boolean | JSONSchemaProperty;
  description?: string;
  default?: unknown;
}

export interface JSONSchemaProperty {
  type?: JSONSchema['type'] | JSONSchema['type'][];
  properties?: Record<string, JSONSchemaProperty>;
  items?: JSONSchemaProperty;
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  additionalProperties?: boolean | JSONSchemaProperty;
  description?: string;
  default?: unknown;
  oneOf?: JSONSchemaProperty[];
  anyOf?: JSONSchemaProperty[];
  allOf?: JSONSchemaProperty[];
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  data?: unknown;
  coerced?: boolean;
}

export interface ValidationError {
  path: string;
  message: string;
  expected?: string;
  received?: string;
}

export interface SchemaValidatorConfig {
  /** Attempt to coerce types (e.g., "123" -> 123) */
  coerceTypes?: boolean;
  /** Remove additional properties not in schema */
  removeAdditional?: boolean;
  /** Use default values for missing properties */
  useDefaults?: boolean;
  /** Max retry attempts for extraction */
  maxRetries?: number;
}

// ============================================================================
// Schema Validator
// ============================================================================

export class SchemaValidator extends EventEmitter {
  private config: Required<SchemaValidatorConfig>;

  constructor(config: SchemaValidatorConfig = {}) {
    super();
    this.config = {
      coerceTypes: config.coerceTypes ?? true,
      removeAdditional: config.removeAdditional ?? true,
      useDefaults: config.useDefaults ?? true,
      maxRetries: config.maxRetries ?? 2,
    };
  }

  /**
   * Validate data against a JSON schema
   */
  validate(data: unknown, schema: JSONSchema): ValidationResult {
    const errors: ValidationError[] = [];
    let coerced = false;

    const validateValue = (
      value: unknown,
      propSchema: JSONSchemaProperty,
      path: string
    ): unknown => {
      // Handle null
      if (value === null || value === undefined) {
        if (propSchema.default !== undefined && this.config.useDefaults) {
          coerced = true;
          return propSchema.default;
        }
        if (propSchema.type === 'null') return null;
        errors.push({
          path,
          message: 'Value is required',
          expected: String(propSchema.type),
          received: 'null/undefined',
        });
        return value;
      }

      // Handle type coercion
      const types = Array.isArray(propSchema.type)
        ? propSchema.type
        : propSchema.type
          ? [propSchema.type]
          : [];

      // Check enum
      if (propSchema.enum && !propSchema.enum.includes(value)) {
        errors.push({
          path,
          message: `Value must be one of: ${propSchema.enum.join(', ')}`,
          expected: propSchema.enum.join(' | '),
          received: String(value),
        });
      }

      // Check const
      if (propSchema.const !== undefined && value !== propSchema.const) {
        errors.push({
          path,
          message: `Value must be ${JSON.stringify(propSchema.const)}`,
          expected: String(propSchema.const),
          received: String(value),
        });
      }

      // Type-specific validation
      for (const type of types) {
        switch (type) {
          case 'string':
            if (typeof value !== 'string') {
              if (this.config.coerceTypes && value != null) {
                coerced = true;
                value = String(value);
              } else {
                errors.push({
                  path,
                  message: 'Expected string',
                  expected: 'string',
                  received: typeof value,
                });
              }
            }
            if (typeof value === 'string') {
              if (propSchema.minLength && value.length < propSchema.minLength) {
                errors.push({
                  path,
                  message: `String too short (min: ${propSchema.minLength})`,
                });
              }
              if (propSchema.maxLength && value.length > propSchema.maxLength) {
                errors.push({
                  path,
                  message: `String too long (max: ${propSchema.maxLength})`,
                });
              }
              if (propSchema.pattern && !new RegExp(propSchema.pattern).test(value)) {
                errors.push({
                  path,
                  message: `String doesn't match pattern: ${propSchema.pattern}`,
                });
              }
            }
            break;

          case 'number':
            if (typeof value !== 'number') {
              if (this.config.coerceTypes && !isNaN(Number(value))) {
                coerced = true;
                value = Number(value);
              } else {
                errors.push({
                  path,
                  message: 'Expected number',
                  expected: 'number',
                  received: typeof value,
                });
              }
            }
            if (typeof value === 'number') {
              if (propSchema.minimum !== undefined && value < propSchema.minimum) {
                errors.push({
                  path,
                  message: `Number too small (min: ${propSchema.minimum})`,
                });
              }
              if (propSchema.maximum !== undefined && value > propSchema.maximum) {
                errors.push({
                  path,
                  message: `Number too large (max: ${propSchema.maximum})`,
                });
              }
            }
            break;

          case 'boolean':
            if (typeof value !== 'boolean') {
              if (this.config.coerceTypes) {
                coerced = true;
                value = value === 'true' || value === 1 || value === '1';
              } else {
                errors.push({
                  path,
                  message: 'Expected boolean',
                  expected: 'boolean',
                  received: typeof value,
                });
              }
            }
            break;

          case 'array':
            if (!Array.isArray(value)) {
              errors.push({
                path,
                message: 'Expected array',
                expected: 'array',
                received: typeof value,
              });
            } else {
              if (propSchema.minItems && value.length < propSchema.minItems) {
                errors.push({
                  path,
                  message: `Array too short (min: ${propSchema.minItems})`,
                });
              }
              if (propSchema.maxItems && value.length > propSchema.maxItems) {
                errors.push({
                  path,
                  message: `Array too long (max: ${propSchema.maxItems})`,
                });
              }
              if (propSchema.items) {
                value = value.map((item, i) =>
                  validateValue(item, propSchema.items!, `${path}[${i}]`)
                );
              }
            }
            break;

          case 'object':
            if (typeof value !== 'object' || Array.isArray(value)) {
              errors.push({
                path,
                message: 'Expected object',
                expected: 'object',
                received: Array.isArray(value) ? 'array' : typeof value,
              });
            } else if (propSchema.properties) {
              const obj = value as Record<string, unknown>;
              const result: Record<string, unknown> = {};

              // Validate required properties
              if (propSchema.required) {
                for (const req of propSchema.required) {
                  if (!(req in obj)) {
                    if (
                      propSchema.properties[req]?.default !== undefined &&
                      this.config.useDefaults
                    ) {
                      obj[req] = propSchema.properties[req].default;
                      coerced = true;
                    } else {
                      errors.push({
                        path: `${path}.${req}`,
                        message: 'Required property missing',
                      });
                    }
                  }
                }
              }

              // Validate each property
              for (const [key, propDef] of Object.entries(propSchema.properties)) {
                if (key in obj) {
                  result[key] = validateValue(obj[key], propDef, `${path}.${key}`);
                } else if (propDef.default !== undefined && this.config.useDefaults) {
                  result[key] = propDef.default;
                  coerced = true;
                }
              }

              // Handle additional properties
              if (this.config.removeAdditional && propSchema.additionalProperties === false) {
                value = result;
              } else {
                // Keep additional properties
                for (const key of Object.keys(obj)) {
                  if (!(key in result)) {
                    result[key] = obj[key];
                  }
                }
                value = result;
              }
            }
            break;
        }
      }

      return value;
    };

    const validatedData = validateValue(data, schema, '$');

    return {
      valid: errors.length === 0,
      errors,
      data: validatedData,
      coerced,
    };
  }

  /**
   * Extract JSON from LLM response text
   */
  extractJSON(text: string): { json: unknown; extracted: boolean } | null {
    // Try direct parse first
    try {
      return { json: JSON.parse(text), extracted: false };
    } catch {
      // Continue with extraction
    }

    // Try to find JSON in code blocks
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const codeBlockBody = codeBlockMatch?.[1];
    if (codeBlockBody !== undefined) {
      try {
        return { json: JSON.parse(codeBlockBody.trim()), extracted: true };
      } catch {
        // Continue
      }
    }

    // Try to find JSON object or array
    const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    const jsonBody = jsonMatch?.[1];
    if (jsonBody !== undefined) {
      try {
        return { json: JSON.parse(jsonBody), extracted: true };
      } catch {
        // Try to fix common issues
        let fixed = jsonBody
          .replace(/,\s*}/g, '}') // Remove trailing commas
          .replace(/,\s*]/g, ']')
          .replace(/'/g, '"') // Replace single quotes
          .replace(/(\w+):/g, '"$1":'); // Quote unquoted keys

        try {
          return { json: JSON.parse(fixed), extracted: true };
        } catch {
          // Give up
        }
      }
    }

    return null;
  }

  /**
   * Validate and extract structured output from LLM response
   */
  validateResponse(
    response: string,
    schema: JSONSchema
  ): ValidationResult & { raw: string } {
    const extracted = this.extractJSON(response);

    if (!extracted) {
      return {
        valid: false,
        errors: [{ path: '$', message: 'Could not extract JSON from response' }],
        raw: response,
      };
    }

    const result = this.validate(extracted.json, schema);

    this.emit('validation', {
      valid: result.valid,
      extracted: extracted.extracted,
      coerced: result.coerced,
      errorCount: result.errors.length,
    });

    if (!result.valid) {
      logger.warn('Schema validation failed', {
        errors: result.errors,
        extracted: extracted.extracted,
      });
    }

    return {
      ...result,
      raw: response,
    };
  }

  /**
   * Create a prompt suffix that instructs the LLM to output valid JSON
   */
  createSchemaPrompt(schema: JSONSchema): string {
    const schemaStr = JSON.stringify(schema, null, 2);
    return `
Respond with valid JSON matching this schema:
\`\`\`json
${schemaStr}
\`\`\`

Important:
- Output ONLY valid JSON, no other text
- Follow the schema exactly
- Include all required fields
- Use correct types (string, number, boolean, array, object)
`.trim();
  }
}

// ============================================================================
// Common Schemas
// ============================================================================

/**
 * Schema for tool call selection
 */
export const TOOL_CALL_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    tool: {
      type: 'string',
      description: 'Name of the tool to call',
    },
    arguments: {
      type: 'object',
      description: 'Arguments to pass to the tool',
      additionalProperties: true,
    },
    reasoning: {
      type: 'string',
      description: 'Why this tool was chosen',
    },
  },
  required: ['tool', 'arguments'],
};

/**
 * Schema for action plan
 */
export const ACTION_PLAN_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    goal: {
      type: 'string',
      description: 'The main goal to achieve',
    },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          tool: { type: 'string' },
          description: { type: 'string' },
          dependencies: {
            type: 'array',
            items: { type: 'number' },
          },
        },
        required: ['action', 'description'],
      },
      description: 'Steps to achieve the goal',
    },
    estimatedSteps: {
      type: 'number',
      description: 'Estimated number of tool calls needed',
    },
  },
  required: ['goal', 'steps'],
};

/**
 * Schema for code edit
 */
export const CODE_EDIT_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    file: {
      type: 'string',
      description: 'File path to edit',
    },
    operation: {
      type: 'string',
      enum: ['create', 'replace', 'insert', 'delete'],
    },
    oldContent: {
      type: 'string',
      description: 'Content to find (for replace/delete)',
    },
    newContent: {
      type: 'string',
      description: 'New content to insert',
    },
    position: {
      type: 'object',
      properties: {
        line: { type: 'number' },
        column: { type: 'number' },
      },
    },
  },
  required: ['file', 'operation'],
};

// ============================================================================
// Singleton
// ============================================================================

let validatorInstance: SchemaValidator | null = null;

export function getSchemaValidator(config?: SchemaValidatorConfig): SchemaValidator {
  if (!validatorInstance) {
    validatorInstance = new SchemaValidator(config);
  }
  return validatorInstance;
}

export function resetSchemaValidator(): void {
  validatorInstance = null;
}
