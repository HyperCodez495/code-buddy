/**
 * Plugin SDK — Testing Utilities
 *
 * Provides mock objects and assertion helpers for testing plugins.
 * These utilities allow plugin authors to write unit tests without
 * depending on the full Code Buddy runtime.
 */

import type { PluginContext, PluginPermissions, PluginProvider } from '../plugins/types.js';
import type { LLMMessage } from '../providers/types.js';
import type { ToolResult } from './tool.js';
import type { LLMProviderPlugin, ModelInfo, LLMChatOptions } from './llm.js';

/**
 * A mock logger that records all log calls for inspection.
 */
export interface MockLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  child(source: string): MockLogger;

  /** All logged messages, in order */
  readonly messages: Array<{ level: string; message: string; args: unknown[] }>;
  /** Clear recorded messages */
  clear(): void;
}

/**
 * Create a mock logger that records all log calls.
 */
function createMockLogger(): MockLogger {
  const messages: Array<{ level: string; message: string; args: unknown[] }> = [];

  const log = (level: string) => (message: string, ...args: unknown[]) => {
    messages.push({ level, message, args });
  };

  return {
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    child(_source: string): MockLogger {
      return createMockLogger();
    },
    get messages() {
      return messages;
    },
    clear() {
      messages.length = 0;
    },
  };
}

/**
 * Options for customizing the mock plugin context.
 */
export interface MockPluginContextOptions {
  /** Custom configuration values */
  config?: Record<string, unknown>;
  /** Custom data directory path */
  dataDir?: string;
  /** Custom logger instance */
  logger?: MockLogger;
}

/**
 * Extended mock context that tracks registered tools, commands, and providers.
 */
export interface MockPluginContext extends Omit<PluginContext, 'logger'> {
  /** Logger cast to MockLogger for inspecting log calls */
  logger: MockLogger;
  /** All tools registered via registerTool() */
  readonly registeredTools: Array<Record<string, unknown>>;
  /** All commands registered via registerCommand() */
  readonly registeredCommands: Array<Record<string, unknown>>;
  /** All providers registered via registerProvider() */
  readonly registeredProviders: PluginProvider[];
  /** Reset all tracked registrations */
  reset(): void;
}

/**
 * Create a mock PluginContext for testing.
 *
 * The returned context records all tool, command, and provider registrations
 * so you can assert on what your plugin registered during activation.
 *
 * @example
 * ```ts
 * import { createMockPluginContext } from '@phuetz/code-buddy/plugin-sdk/testing';
 *
 * const ctx = createMockPluginContext({ config: { apiKey: 'test-key' } });
 * await myPlugin.activate(ctx);
 *
 * expect(ctx.registeredTools).toHaveLength(2);
 * expect(ctx.registeredTools[0].name).toBe('my_tool');
 * ```
 */
export function createMockPluginContext(overrides?: MockPluginContextOptions): MockPluginContext {
  const mockLogger = overrides?.logger ?? createMockLogger();
  const registeredTools: Array<Record<string, unknown>> = [];
  const registeredCommands: Array<Record<string, unknown>> = [];
  const registeredProviders: PluginProvider[] = [];

  return {
    logger: mockLogger,
    config: overrides?.config ?? {},
    dataDir: overrides?.dataDir ?? '/tmp/plugin-test-data',
    registerTool(tool) {
      registeredTools.push(tool as unknown as Record<string, unknown>);
    },
    registerCommand(command) {
      registeredCommands.push(command as unknown as Record<string, unknown>);
    },
    registerProvider(provider) {
      registeredProviders.push(provider);
    },
    registerContextEngine(_engine) {
      // No-op in test mock
    },
    get registeredTools() {
      return registeredTools;
    },
    get registeredCommands() {
      return registeredCommands;
    },
    get registeredProviders() {
      return registeredProviders;
    },
    reset() {
      registeredTools.length = 0;
      registeredCommands.length = 0;
      registeredProviders.length = 0;
      mockLogger.clear();
    },
  };
}

/**
 * Options for customizing the mock LLM provider.
 */
export interface MockLLMProviderOptions {
  /** Provider ID */
  id?: string;
  /** Provider name */
  name?: string;
  /** Canned responses to return from chat() in order. Cycles if exhausted. */
  responses?: string[];
  /** Models to return from listModels() */
  models?: ModelInfo[];
}

/**
 * Extended mock LLM provider that tracks calls.
 */
export interface MockLLMProviderInstance extends LLMProviderPlugin {
  /** All chat() calls made, in order */
  readonly chatCalls: Array<{ messages: LLMMessage[]; options?: LLMChatOptions }>;
  /** All complete() calls made, in order */
  readonly completeCalls: Array<{ prompt: string; options?: LLMChatOptions }>;
  /** Reset tracked calls */
  resetCalls(): void;
}

/**
 * Create a mock LLM provider for testing.
 *
 * Returns canned responses and records all calls for assertions.
 *
 * @example
 * ```ts
 * import { createMockLLMProvider } from '@phuetz/code-buddy/plugin-sdk/testing';
 *
 * const provider = createMockLLMProvider({
 *   responses: ['Hello!', 'How can I help?'],
 * });
 *
 * const result = await provider.chat([{ role: 'user', content: 'Hi' }]);
 * expect(result).toBe('Hello!');
 * expect(provider.chatCalls).toHaveLength(1);
 * ```
 */
export function createMockLLMProvider(options?: MockLLMProviderOptions): MockLLMProviderInstance {
  const responses = options?.responses ?? ['Mock LLM response'];
  const models = options?.models ?? [
    { name: 'mock-model', contextWindow: 128000, maxOutput: 4096 },
  ];

  const chatCalls: Array<{ messages: LLMMessage[]; options?: LLMChatOptions }> = [];
  const completeCalls: Array<{ prompt: string; options?: LLMChatOptions }> = [];
  let responseIndex = 0;

  function getNextResponse(): string {
    const response = responses[responseIndex % responses.length];
    responseIndex++;
    return response ?? 'Mock LLM response';
  }

  return {
    id: options?.id ?? 'mock-llm',
    name: options?.name ?? 'Mock LLM Provider',
    type: 'llm',
    priority: 0,

    async initialize() {
      // No-op for mock
    },

    async shutdown() {
      // No-op for mock
    },

    async chat(messages: LLMMessage[], chatOptions?: LLMChatOptions): Promise<string> {
      chatCalls.push({ messages, options: chatOptions });
      return getNextResponse();
    },

    async complete(prompt: string, completeOptions?: LLMChatOptions): Promise<string> {
      completeCalls.push({ prompt, options: completeOptions });
      return getNextResponse();
    },

    async listModels(): Promise<ModelInfo[]> {
      return [...models];
    },

    async getModelInfo(modelName: string): Promise<ModelInfo | undefined> {
      return models.find(m => m.name === modelName);
    },

    get chatCalls() {
      return chatCalls;
    },
    get completeCalls() {
      return completeCalls;
    },
    resetCalls() {
      chatCalls.length = 0;
      completeCalls.length = 0;
      responseIndex = 0;
    },
  };
}

/**
 * Assert that a tool result matches expected values.
 *
 * Checks `success`, `output`, and `error` fields.
 * Throws an error with a descriptive message on mismatch.
 *
 * @example
 * ```ts
 * import { assertToolResult } from '@phuetz/code-buddy/plugin-sdk/testing';
 *
 * const result = await myTool.execute({ city: 'Paris' });
 * assertToolResult(result, { success: true, output: 'sunny' });
 * ```
 */
export function assertToolResult(
  result: ToolResult,
  expected: Partial<ToolResult>,
): void {
  if (expected.success !== undefined && result.success !== expected.success) {
    throw new Error(
      `Expected tool result success to be ${expected.success}, got ${result.success}` +
      (result.error ? ` (error: ${result.error})` : '')
    );
  }

  if (expected.output !== undefined) {
    if (result.output === undefined) {
      throw new Error(`Expected tool result output to contain "${expected.output}", but output is undefined`);
    }
    if (!result.output.includes(expected.output)) {
      throw new Error(
        `Expected tool result output to contain "${expected.output}", got "${result.output}"`
      );
    }
  }

  if (expected.error !== undefined) {
    if (result.error === undefined) {
      throw new Error(`Expected tool result error to contain "${expected.error}", but error is undefined`);
    }
    if (!result.error.includes(expected.error)) {
      throw new Error(
        `Expected tool result error to contain "${expected.error}", got "${result.error}"`
      );
    }
  }
}
