/**
 * Verify Tool Adapter
 *
 * ITool-compliant adapter that makes the independent Verifier agent REACHABLE
 * at runtime as an LLM tool. The agent calls `verify` to explicitly delegate a
 * "does this actually work?" check to a fresh-context verifier (Manus doctrine:
 * "delegate to the verifier"), which reproduces the work, runs real oracles and
 * hands back a CONFIRMED / NEEDS REVIEW verdict with evidence.
 *
 * The Verifier is an LLM+tools agent: it needs an `llmCall` (to reason) and an
 * `executeTool` (to drive read/execute-only tools). Those are supplied once at
 * boot by the host CodeBuddyAgent via `setVerifyToolProvider()` — the agent
 * already owns both a `CodeBuddyClient` and a tool executor, so this reuses the
 * same plumbing the SWE/multi-agent bridges use. When no provider is wired the
 * tool fails closed with a clear configuration error (never a silent no-op).
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import type {
  SWEMessage,
  SWETool,
  SWELLMResponse,
  SWEToolResult,
} from '../../agent/specialized/swe-agent.js';

/** LLM bridge the Verifier reasons through (same shape as the SWE agent). */
export type VerifyLlmCall = (messages: SWEMessage[], tools: SWETool[]) => Promise<SWELLMResponse>;
/** Tool executor the Verifier drives (gated read/execute-only inside the agent). */
export type VerifyExecuteTool = (name: string, args: Record<string, unknown>) => Promise<SWEToolResult>;

/**
 * The callable bridge the host injects so the `verify` tool can run the
 * Verifier agent. Kept behind a provider (not imported statically) so the tool
 * module has no dependency on a live LLM client — the agent owns that.
 */
export interface VerifyToolProvider {
  llmCall: VerifyLlmCall;
  executeTool: VerifyExecuteTool;
}

let _verifyProvider: (() => VerifyToolProvider) | null = null;

/**
 * Wire the llmCall + executeTool bridge for the `verify` tool. Called once from
 * codebuddy-agent.ts with the agent's own client + tool executor.
 */
export function setVerifyToolProvider(provider: () => VerifyToolProvider): void {
  _verifyProvider = provider;
}

/** Reset the provider (for testing). */
export function resetVerifyToolProvider(): void {
  _verifyProvider = null;
}

export class VerifyTool implements ITool {
  readonly name = 'verify';
  readonly description =
    'Delegate to an independent, fresh-context Verifier that runs real oracles and returns a CONFIRMED / NEEDS REVIEW verdict with evidence. Read-only — it never edits files.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const instruction =
      typeof input.instruction === 'string' && input.instruction.trim()
        ? input.instruction.trim()
        : typeof input._input === 'string'
          ? (input._input as string)
          : '';
    if (!instruction) {
      return { success: false, error: 'verify requires an `instruction` describing what to verify.' };
    }

    if (!_verifyProvider) {
      // Fail closed: the tool is registered but the host never wired the LLM
      // bridge, so it cannot run the Verifier. Surface a clear config error.
      return {
        success: false,
        error:
          'verify is not wired to an LLM bridge (setVerifyToolProvider was never called). This is a configuration error.',
      };
    }

    const url = typeof input.url === 'string' && input.url.trim() ? input.url.trim() : undefined;

    try {
      const { llmCall, executeTool } = _verifyProvider();

      // Route through the AgentRegistry so the Verifier's own toolset gate
      // (read/execute only, writes refused fail-closed) and doctrine prompt
      // apply. This is the runtime call-site that makes the Verifier reachable.
      const { AgentRegistry } = await import('../../agent/specialized/agent-registry.js');
      const registry = new AgentRegistry();
      await registry.registerBuiltInAgents();

      const result = await registry.executeOn('verifier', {
        action: 'verify',
        params: {
          llmCall,
          executeTool,
          instruction,
          ...(url ? { url } : {}),
        },
      });

      if (!result.success) {
        return { success: false, error: result.error || 'Verifier failed to produce a verdict.' };
      }

      const verdict = (result.metadata as { verdict?: string } | undefined)?.verdict;
      const header = verdict ? `[Verifier verdict: ${verdict}]\n` : '';
      return { success: true, output: `${header}${result.output ?? ''}`.trim() };
    } catch (error) {
      return {
        success: false,
        error: `verify failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          instruction: {
            type: 'string',
            description: 'What to verify — the change/flow and the claim to prove.',
          },
          url: {
            type: 'string',
            description: 'Optional URL to drive when verifying a running web UI.',
          },
        },
        required: ['instruction'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.instruction !== 'string' || !data.instruction.trim()) {
      // Pipeline callers may pass _input instead; allow that through validate.
      if (typeof data._input !== 'string' || !data._input.trim()) {
        return { valid: false, errors: ['instruction must be a non-empty string'] };
      }
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['verify', 'verification', 'evidence', 'confirm', 'validate', 'oracle', 'independent', 'test', 'proof'],
      priority: 6,
      requiresConfirmation: true,
      modifiesFiles: false,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createVerifyTools(): ITool[] {
  return [new VerifyTool()];
}

export function resetVerifyInstances(): void {
  // Stateless tool — nothing instance-level to reset (provider reset is separate).
}
