/**
 * Session Tool Adapters
 *
 * ITool-compliant adapters for the 4 session coordination tools that wake
 * SessionToolExecutor (Phase E of the multi-agent integration plan).
 *
 * Each adapter delegates to the shared SessionToolExecutor singleton,
 * which dispatches to the underlying SessionRegistry. The registry is
 * lazy-instantiated on first use; persistence + cleanup timer require
 * [multi_agent_system.sessions].enabled in TOML (Phase F boot wiring).
 *
 * Safety V0.1 (built into SessionRegistry.spawnSession):
 * - MAX_SPAWN_DEPTH = 3 (height of the spawn tree)
 * - MAX_SESSIONS_PER_WORKFLOW = 10 (breadth cap per root session)
 * - sandboxed: true on every spawn (forced)
 *
 * Phase E does NOT add ConfirmationService gating — V0.2 will introduce
 * that for sessions_send / sessions_spawn (cf. requiresConfirmation
 * field in metadata is reserved for V0.2). For now, callers (the LLM)
 * are trusted within the depth+breadth caps.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import {
  SESSIONS_LIST_TOOL,
  SESSIONS_HISTORY_TOOL,
  SESSIONS_SEND_TOOL,
  SESSIONS_SPAWN_TOOL,
} from '../../agent/multi-agent/session-tools.js';
import type { CodeBuddyTool } from '../../codebuddy/client.js';

/** Lazy-import the executor to avoid pulling SessionRegistry at module load. */
async function getExecutor() {
  const { getSessionToolExecutor } = await import('../../agent/multi-agent/session-tools.js');
  return getSessionToolExecutor();
}

/**
 * Generic adapter for any of the 4 SESSION_TOOLS. Wraps the existing
 * CodeBuddyTool definition (parameters schema, description) and routes
 * execution through SessionToolExecutor.execute(toolName, args).
 */
class SessionToolAdapter implements ITool {
  constructor(private readonly tool: CodeBuddyTool) {}

  get name(): string {
    return this.tool.function.name;
  }

  get description(): string {
    return this.tool.function.description ?? '';
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const executor = await getExecutor();
    const result = await executor.execute(this.name, input ?? {});
    if (result.success) {
      return {
        success: true,
        output: result.output ?? (result.data ? JSON.stringify(result.data, null, 2) : ''),
      };
    }
    return { success: false, error: result.error ?? 'Unknown session-tool error' };
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: this.tool.function.parameters as ToolSchema['parameters'],
    };
  }

  validate(_input: unknown): IValidationResult {
    // Schema validation done by the LLM provider's tool-call validation.
    // Adapter accepts anything; SessionToolExecutor returns {success: false}
    // on missing required fields with a clear error message.
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['sessions', 'multi-agent', this.name.replace('sessions_', '')],
      priority: this.name === 'sessions_spawn' ? 7 : 5,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createSessionTools(): ITool[] {
  return [
    new SessionToolAdapter(SESSIONS_LIST_TOOL),
    new SessionToolAdapter(SESSIONS_HISTORY_TOOL),
    new SessionToolAdapter(SESSIONS_SEND_TOOL),
    new SessionToolAdapter(SESSIONS_SPAWN_TOOL),
  ];
}
