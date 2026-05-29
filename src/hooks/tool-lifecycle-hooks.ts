/**
 * Enterprise-grade Tool Lifecycle Hook System
 *
 * Implements priority-ordered, typed hooks for tool execution:
 *
 * Execution Models:
 * - Void Hooks (parallel): Fire-and-forget, run all handlers simultaneously
 * - Modifying Hooks (sequential): Execute in priority order, can transform data
 *
 * Tool-specific hooks:
 * - before_tool_call: Modify or block tool calls (sequential)
 * - after_tool_call: Observer hook post-execution (parallel)
 * - tool_result_persist: Synchronous hook for transcript persistence
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type HookEvent =
  | 'before_tool_call'
  | 'after_tool_call'
  | 'tool_result_persist'
  | 'agent_start'
  | 'agent_end'
  | 'message_received'
  | 'message_sending';

export type HookExecutionMode = 'parallel' | 'sequential' | 'sync';

export interface HookContext {
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolCallId?: string;
  sessionId?: string;
  agentId?: string;
  timestamp: Date;
}

export interface ToolCallContext extends HookContext {
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolCallId: string;
}

export interface ToolResultContext extends ToolCallContext {
  result: {
    success: boolean;
    output?: string;
    error?: string;
  };
  durationMs: number;
}

export interface BeforeToolCallResult {
  /** If true, block the tool call */
  blocked?: boolean;
  /** Reason for blocking */
  blockReason?: string;
  /** Modified arguments to use instead */
  modifiedArgs?: Record<string, unknown>;
  /** Additional context to pass through */
  metadata?: Record<string, unknown>;
}

export interface HookHandler<TContext = HookContext, TResult = void> {
  /** Unique identifier for this handler */
  id: string;
  /** Higher priority handlers execute first */
  priority: number;
  /** The handler function */
  handler: (context: TContext) => TResult | Promise<TResult>;
  /** Whether to catch errors (log instead of propagate) */
  catchErrors?: boolean;
  /** Description for debugging */
  description?: string;
}

interface HookDefinition {
  mode: HookExecutionMode;
  contextType: string;
  resultType: string;
}

// ============================================================================
// Hook Definitions
// ============================================================================

const HOOK_DEFINITIONS: Record<HookEvent, HookDefinition> = {
  before_tool_call: {
    mode: 'sequential',
    contextType: 'ToolCallContext',
    resultType: 'BeforeToolCallResult',
  },
  after_tool_call: {
    mode: 'parallel',
    contextType: 'ToolResultContext',
    resultType: 'void',
  },
  tool_result_persist: {
    mode: 'sync',
    contextType: 'ToolResultContext',
    resultType: 'void',
  },
  agent_start: {
    mode: 'sequential',
    contextType: 'HookContext',
    resultType: 'void',
  },
  agent_end: {
    mode: 'parallel',
    contextType: 'HookContext',
    resultType: 'void',
  },
  message_received: {
    mode: 'parallel',
    contextType: 'HookContext',
    resultType: 'void',
  },
  message_sending: {
    mode: 'sequential',
    contextType: 'HookContext',
    resultType: 'void',
  },
};

// ============================================================================
// Tool Lifecycle Hooks Manager
// ============================================================================

export class ToolLifecycleHooks extends EventEmitter {
  private hooks: Map<HookEvent, HookHandler<any, any>[]> = new Map();
  private executionStats: Map<string, { calls: number; errors: number; totalMs: number }> = new Map();

  constructor() {
    super();
    // Initialize empty hook arrays for each event
    for (const event of Object.keys(HOOK_DEFINITIONS) as HookEvent[]) {
      this.hooks.set(event, []);
    }
  }

  /**
   * Register a hook handler
   */
  register<TContext = HookContext, TResult = void>(
    event: HookEvent,
    handler: HookHandler<TContext, TResult>
  ): () => void {
    const handlers = this.hooks.get(event) || [];

    // Check for duplicate ID
    if (handlers.some(h => h.id === handler.id)) {
      throw new Error(`Hook handler with ID "${handler.id}" already registered for event "${event}"`);
    }

    handlers.push(handler);

    // Sort by priority (highest first)
    handlers.sort((a, b) => b.priority - a.priority);

    this.hooks.set(event, handlers);
    this.emit('hook:registered', { event, handlerId: handler.id });

    // Return unregister function
    return () => this.unregister(event, handler.id);
  }

  /**
   * Unregister a hook handler
   */
  unregister(event: HookEvent, handlerId: string): boolean {
    const handlers = this.hooks.get(event) || [];
    const index = handlers.findIndex(h => h.id === handlerId);

    if (index === -1) {
      return false;
    }

    handlers.splice(index, 1);
    this.hooks.set(event, handlers);
    this.emit('hook:unregistered', { event, handlerId });
    return true;
  }

  /**
   * Execute before_tool_call hooks (sequential, can block/modify)
   */
  async executeBeforeToolCall(context: ToolCallContext): Promise<BeforeToolCallResult> {
    const handlers = this.hooks.get('before_tool_call') || [];
    let result: BeforeToolCallResult = {};
    let currentArgs = { ...context.toolArgs };

    for (const handler of handlers) {
      const startTime = Date.now();
      try {
        const handlerResult = await this.executeHandler(handler, {
          ...context,
          toolArgs: currentArgs,
        });

        if (handlerResult) {
          // Merge results
          if (handlerResult.blocked) {
            result.blocked = true;
            result.blockReason = handlerResult.blockReason || `Blocked by hook ${handler.id}`;
            break; // Stop processing on block
          }

          if (handlerResult.modifiedArgs) {
            currentArgs = { ...currentArgs, ...handlerResult.modifiedArgs };
            result.modifiedArgs = currentArgs;
          }

          if (handlerResult.metadata) {
            result.metadata = { ...result.metadata, ...handlerResult.metadata };
          }
        }

        this.recordExecution(handler.id, Date.now() - startTime, false);
      } catch (error) {
        this.recordExecution(handler.id, Date.now() - startTime, true);
        if (!handler.catchErrors) {
          throw error;
        }
        logger.error(`Hook ${handler.id} error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    this.emit('hook:executed', { event: 'before_tool_call', result });
    return result;
  }

  /**
   * Execute after_tool_call hooks (parallel, fire-and-forget)
   */
  async executeAfterToolCall(context: ToolResultContext): Promise<void> {
    const handlers = this.hooks.get('after_tool_call') || [];

    // Execute all handlers in parallel
    const promises = handlers.map(async handler => {
      const startTime = Date.now();
      try {
        await this.executeHandler(handler, context);
        this.recordExecution(handler.id, Date.now() - startTime, false);
      } catch (error) {
        this.recordExecution(handler.id, Date.now() - startTime, true);
        if (!handler.catchErrors) {
          logger.error(`Hook ${handler.id} error: ${error instanceof Error ? error.message : String(error)}`);
        }
        // Don't rethrow - parallel hooks shouldn't block each other
      }
    });

    await Promise.all(promises);
    this.emit('hook:executed', { event: 'after_tool_call' });
  }

  /**
   * Execute tool_result_persist hooks (SYNCHRONOUS - for hot paths)
   * WARNING: Handlers MUST be synchronous. Async handlers will trigger a warning.
   */
  executeToolResultPersist(context: ToolResultContext): void {
    const handlers = this.hooks.get('tool_result_persist') || [];

    for (const handler of handlers) {
      const startTime = Date.now();
      try {
        const result = handler.handler(context);

        // Warn if handler returns a promise (should be sync)
        if (result instanceof Promise) {
          logger.warn(
            `Hook ${handler.id} for tool_result_persist returned a Promise. ` +
            'This hook should be synchronous for hot path performance.'
          );
        }

        this.recordExecution(handler.id, Date.now() - startTime, false);
      } catch (error) {
        this.recordExecution(handler.id, Date.now() - startTime, true);
        if (!handler.catchErrors) {
          throw error;
        }
        logger.error(`Hook ${handler.id} error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    this.emit('hook:executed', { event: 'tool_result_persist' });
  }

  /**
   * Execute generic hooks based on their mode
   */
  async executeHooks(event: HookEvent, context: HookContext): Promise<void> {
    const definition = HOOK_DEFINITIONS[event];
    const handlers = this.hooks.get(event) || [];

    if (handlers.length === 0) {
      return;
    }

    switch (definition.mode) {
      case 'parallel':
        await Promise.all(
          handlers.map(h => this.executeHandlerSafe(h, context))
        );
        break;

      case 'sequential':
        for (const handler of handlers) {
          await this.executeHandlerSafe(handler, context);
        }
        break;

      case 'sync':
        for (const handler of handlers) {
          this.executeHandlerSync(handler, context);
        }
        break;
    }

    this.emit('hook:executed', { event });
  }

  /**
   * Execute a handler with error handling
   */
  private async executeHandler<TContext, TResult>(
    handler: HookHandler<TContext, TResult>,
    context: TContext
  ): Promise<TResult> {
    return handler.handler(context);
  }

  /**
   * Execute handler with safe error handling
   */
  private async executeHandlerSafe(
    handler: HookHandler<any, any>,
    context: HookContext
  ): Promise<void> {
    const startTime = Date.now();
    try {
      await handler.handler(context);
      this.recordExecution(handler.id, Date.now() - startTime, false);
    } catch (error) {
      this.recordExecution(handler.id, Date.now() - startTime, true);
      if (!handler.catchErrors) {
        logger.error(`Hook ${handler.id} error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Execute handler synchronously
   */
  private executeHandlerSync(
    handler: HookHandler<any, any>,
    context: HookContext
  ): void {
    const startTime = Date.now();
    try {
      handler.handler(context);
      this.recordExecution(handler.id, Date.now() - startTime, false);
    } catch (error) {
      this.recordExecution(handler.id, Date.now() - startTime, true);
      if (!handler.catchErrors) {
        throw error;
      }
      logger.error(`Hook ${handler.id} error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Record execution statistics
   */
  private recordExecution(handlerId: string, durationMs: number, isError: boolean): void {
    const stats = this.executionStats.get(handlerId) || { calls: 0, errors: 0, totalMs: 0 };
    stats.calls++;
    stats.totalMs += durationMs;
    if (isError) {
      stats.errors++;
    }
    this.executionStats.set(handlerId, stats);
  }

  /**
   * Check if any hooks are registered for an event
   */
  hasHooks(event: HookEvent): boolean {
    return (this.hooks.get(event)?.length || 0) > 0;
  }

  /**
   * Get the number of hooks for an event
   */
  getHookCount(event: HookEvent): number {
    return this.hooks.get(event)?.length || 0;
  }

  /**
   * Get all registered handlers for an event
   */
  getHandlers(event: HookEvent): HookHandler<any, any>[] {
    return [...(this.hooks.get(event) || [])];
  }

  /**
   * Get execution statistics
   */
  getStats(): Map<string, { calls: number; errors: number; totalMs: number; avgMs: number }> {
    const result = new Map<string, { calls: number; errors: number; totalMs: number; avgMs: number }>();
    for (const [id, stats] of this.executionStats) {
      result.set(id, {
        ...stats,
        avgMs: stats.calls > 0 ? stats.totalMs / stats.calls : 0,
      });
    }
    return result;
  }

  /**
   * Clear all hooks
   */
  clearAll(): void {
    for (const event of this.hooks.keys()) {
      this.hooks.set(event, []);
    }
    this.executionStats.clear();
    this.emit('hooks:cleared');
  }

  /**
   * Clear hooks for a specific event
   */
  clearEvent(event: HookEvent): void {
    this.hooks.set(event, []);
    this.emit('hooks:cleared', { event });
  }
}

// ============================================================================
// Singleton & Convenience Functions
// ============================================================================

let hooksInstance: ToolLifecycleHooks | null = null;

export function getToolLifecycleHooks(): ToolLifecycleHooks {
  if (!hooksInstance) {
    hooksInstance = new ToolLifecycleHooks();
  }
  return hooksInstance;
}

export function resetToolLifecycleHooks(): void {
  hooksInstance = null;
}

/**
 * Convenience: Register a before_tool_call hook
 */
export function onBeforeToolCall(
  id: string,
  handler: (context: ToolCallContext) => BeforeToolCallResult | Promise<BeforeToolCallResult>,
  options: { priority?: number; catchErrors?: boolean; description?: string } = {}
): () => void {
  return getToolLifecycleHooks().register<ToolCallContext, BeforeToolCallResult>('before_tool_call', {
    id,
    priority: options.priority ?? 0,
    handler,
    catchErrors: options.catchErrors ?? true,
    description: options.description,
  });
}

/**
 * Convenience: Register an after_tool_call hook
 */
export function onAfterToolCall(
  id: string,
  handler: (context: ToolResultContext) => void | Promise<void>,
  options: { priority?: number; catchErrors?: boolean; description?: string } = {}
): () => void {
  return getToolLifecycleHooks().register<ToolResultContext, void>('after_tool_call', {
    id,
    priority: options.priority ?? 0,
    handler,
    catchErrors: options.catchErrors ?? true,
    description: options.description,
  });
}

/**
 * Convenience: Register a tool_result_persist hook (SYNC ONLY)
 */
export function onToolResultPersist(
  id: string,
  handler: (context: ToolResultContext) => void,
  options: { priority?: number; catchErrors?: boolean; description?: string } = {}
): () => void {
  return getToolLifecycleHooks().register<ToolResultContext, void>('tool_result_persist', {
    id,
    priority: options.priority ?? 0,
    handler,
    catchErrors: options.catchErrors ?? true,
    description: options.description,
  });
}

// ============================================================================
// Pre-built Hook Handlers
// ============================================================================

/**
 * Create a logging hook for tool calls
 */
export function createLoggingHook(logFn: (msg: string) => void = console.log): {
  before: () => void;
  after: () => void;
} {
  return {
    before: () => onBeforeToolCall(
      'logging-before',
      (ctx) => {
        logFn(`[Tool] Calling ${ctx.toolName} with args: ${JSON.stringify(ctx.toolArgs)}`);
        return {};
      },
      { priority: -100 } // Low priority, run last
    ),
    after: () => onAfterToolCall(
      'logging-after',
      (ctx) => {
        const status = ctx.result.success ? 'SUCCESS' : 'FAILED';
        logFn(`[Tool] ${ctx.toolName} ${status} in ${ctx.durationMs}ms`);
      },
      { priority: -100 }
    ),
  };
}

/**
 * Create a rate limiting hook
 */
export function createRateLimitHook(
  maxCallsPerMinute: number,
  toolPattern?: RegExp
): () => void {
  const callTimes: number[] = [];

  return onBeforeToolCall(
    'rate-limit',
    (ctx) => {
      // Check if this tool should be rate limited
      if (toolPattern && !toolPattern.test(ctx.toolName)) {
        return {};
      }

      const now = Date.now();
      const oneMinuteAgo = now - 60000;

      // Remove old entries
      let oldest = callTimes[0];
      while (oldest !== undefined && oldest < oneMinuteAgo) {
        callTimes.shift();
        oldest = callTimes[0];
      }

      if (callTimes.length >= maxCallsPerMinute) {
        return {
          blocked: true,
          blockReason: `Rate limit exceeded: ${maxCallsPerMinute} calls per minute`,
        };
      }

      callTimes.push(now);
      return {};
    },
    { priority: 100 } // High priority, run first
  );
}

/**
 * Create an argument sanitization hook
 */
export function createSanitizationHook(
  sanitizers: Record<string, (args: Record<string, unknown>) => Record<string, unknown>>
): () => void {
  return onBeforeToolCall(
    'sanitization',
    (ctx) => {
      const sanitizer = sanitizers[ctx.toolName];
      if (sanitizer) {
        return { modifiedArgs: sanitizer(ctx.toolArgs) };
      }
      return {};
    },
    { priority: 50 }
  );
}
