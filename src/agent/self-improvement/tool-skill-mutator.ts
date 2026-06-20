/**
 * Tool mutator port — applies/reverts an authored tool across BOTH registries
 * with a proven inverse, so the engine can keep it (auto-apply) or cleanly
 * un-register it (propose-only / rejection):
 *   - FormalToolRegistry  → makes it CALLABLE (dispatch reads this),
 *   - legacy ToolRegistry → makes its schema VISIBLE to the model next turn.
 *
 * @module agent/self-improvement/tool-skill-mutator
 */

import type { CodeBuddyTool } from '../../codebuddy/client.js';
import type { ToolMetadata } from '../../tools/types.js';
import { FormalToolRegistry } from '../../tools/registry/tool-registry.js';
import { getToolRegistry } from '../../tools/registry.js';
import { buildAuthoredTool, type AuthoredToolSpec } from './authored-tool-runtime.js';

export interface ToolMutatorPort {
  register(spec: AuthoredToolSpec): { name: string };
  unregister(name: string): boolean;
  has(name: string): boolean;
}

/** Dual-registry mutator over the live singletons. */
export class LiveToolMutator implements ToolMutatorPort {
  register(spec: AuthoredToolSpec): { name: string } {
    const tool = buildAuthoredTool(spec);
    FormalToolRegistry.getInstance().register(tool, { override: true });
    const definition: CodeBuddyTool = {
      type: 'function',
      function: {
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters as unknown as CodeBuddyTool['function']['parameters'],
      },
    };
    const metadata: ToolMetadata = {
      name: spec.name,
      category: 'system',
      keywords: ['authored', 'self-extension', 'tool'],
      priority: 5,
      description: spec.description,
    };
    getToolRegistry().registerTool(definition, metadata);
    return { name: spec.name };
  }

  unregister(name: string): boolean {
    const a = FormalToolRegistry.getInstance().unregister(name);
    const b = getToolRegistry().removeTool(name);
    return a || b;
  }

  has(name: string): boolean {
    return FormalToolRegistry.getInstance().has(name) || getToolRegistry().getTool(name) !== undefined;
  }
}
