/**
 * @phuetz/ai-providers — Tool Format Converters
 *
 * Convert between OpenAI, Gemini, and Claude tool formats.
 * Provider-agnostic Rosetta Stone for tool calling.
 */

import type {
  ToolDefinition,
  ToolWrapper,
  ToolCall,
  ToolResult,
  JSONSchema,
  LLMMessage,
} from './types.js';

// ============================================================================
// Format Converters: Tool Definitions
// ============================================================================

/**
 * Convert ToolDefinition to OpenAI function-calling format.
 * Also used by xAI (Grok), LM Studio, and Ollama.
 */
export function toOpenAITools(tools: ToolDefinition[]): ToolWrapper[] {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/** Gemini function declaration format. */
export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'OBJECT';
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

/**
 * Convert ToolDefinition to Gemini function declaration format.
 * Gemini uses uppercase types (STRING, NUMBER, etc.).
 */
export function toGeminiTools(tools: ToolDefinition[]): GeminiFunctionDeclaration[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: convertSchemaToGemini(tool.parameters),
  }));
}

function convertSchemaToGemini(schema: JSONSchema): GeminiFunctionDeclaration['parameters'] {
  const properties: Record<string, { type: string; description?: string; enum?: string[] }> = {};

  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      properties[key] = {
        type: prop.type.toUpperCase(),
        description: prop.description,
        enum: prop.enum?.map(String),
      };
    }
  }

  return {
    type: 'OBJECT',
    properties,
    required: schema.required,
  };
}

/** Claude tool format. */
export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: JSONSchema;
}

/**
 * Convert ToolDefinition to Claude (Anthropic) format.
 */
export function toClaudeTools(tools: ToolDefinition[]): ClaudeTool[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

// ============================================================================
// Format Converters: Tool Calls (Response Parsing)
// ============================================================================

/**
 * Parse tool calls from OpenAI-format response.
 */
export function parseOpenAIToolCalls(
  toolCalls: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>,
): ToolCall[] {
  return toolCalls.map(tc => ({
    id: tc.id,
    type: 'function' as const,
    function: {
      name: tc.function.name,
      arguments: tc.function.arguments,
    },
  }));
}

/**
 * Parse tool calls from Gemini-format response (functionCall parts).
 */
export function parseGeminiToolCalls(
  parts: Array<{ functionCall?: { name: string; args: unknown } }>,
): ToolCall[] {
  return parts
    .filter(p => p.functionCall)
    .map((p, i) => ({
      id: `gemini-call-${Date.now()}-${i}`,
      type: 'function' as const,
      function: {
        name: p.functionCall!.name,
        arguments: JSON.stringify(p.functionCall!.args ?? {}),
      },
    }));
}

/**
 * Parse tool calls from Claude-format response (tool_use content blocks).
 */
export function parseClaudeToolCalls(
  content: Array<{ type: string; id?: string; name?: string; input?: unknown }>,
): ToolCall[] {
  return content
    .filter(block => block.type === 'tool_use' && block.id && block.name)
    .map(block => ({
      id: block.id!,
      type: 'function' as const,
      function: {
        name: block.name!,
        arguments: JSON.stringify(block.input ?? {}),
      },
    }));
}

// ============================================================================
// Format Converters: Tool Results (for sending back to model)
// ============================================================================

/**
 * Create an OpenAI-format tool result message.
 */
export function toOpenAIToolResult(result: ToolResult): LLMMessage {
  return {
    role: 'tool',
    content: result.content,
    tool_call_id: result.tool_call_id,
  };
}

/**
 * Create a Gemini-format function response part.
 */
export function toGeminiFunctionResponse(
  name: string,
  result: ToolResult,
): { functionResponse: { name: string; response: unknown } } {
  let response: unknown;
  try {
    response = JSON.parse(result.content);
  } catch {
    response = { result: result.content };
  }

  return {
    functionResponse: {
      name,
      response,
    },
  };
}

/**
 * Create a Claude-format tool result content block.
 */
export function toClaudeToolResult(
  result: ToolResult,
): { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean } {
  return {
    type: 'tool_result',
    tool_use_id: result.tool_call_id,
    content: result.content,
    is_error: result.error,
  };
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Safely parse tool call arguments from JSON string.
 */
export function parseToolArguments(argsString: string): Record<string, unknown> {
  try {
    return JSON.parse(argsString);
  } catch {
    return {};
  }
}

/**
 * Check if a message contains tool calls.
 */
export function hasToolCalls(message: LLMMessage): boolean {
  return message.role === 'assistant' &&
    Array.isArray(message.tool_calls) &&
    message.tool_calls.length > 0;
}
