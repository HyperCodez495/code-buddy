/**
 * Deferred MCP-schema state — extracted so `tool_search` can read it WITHOUT
 * importing `codebuddy/tools.ts` (which imports `tool_search`), breaking the
 * `tools.ts ↔ tool-search.ts` import cycle. Both sides now depend one-way on
 * this small state module; neither imports the other for deferred schemas.
 *
 * Deferred mode: when an MCP server exposes more tools than the threshold, only
 * name+description stubs go to the LLM and the FULL schemas live here, resolved
 * on demand by `tool_search`. This keeps the prompt small without losing reach.
 */

import type { CodeBuddyTool } from '../codebuddy/client.js';

let _deferredMCPSchemas: Map<string, CodeBuddyTool> | null = null;

/** Replace the deferred-schema map (null = deferred mode off). Owned by the assembler in tools.ts. */
export function setDeferredMCPSchemas(schemas: Map<string, CodeBuddyTool> | null): void {
  _deferredMCPSchemas = schemas;
}

/** The deferred MCP schemas map (empty when off) — for tool_search to resolve full schemas. */
export function getDeferredMCPSchemas(): Map<string, CodeBuddyTool> {
  return _deferredMCPSchemas ?? new Map();
}

/** True when deferred MCP schema loading is active (some schemas are held back as stubs). */
export function isDeferredSchemaMode(): boolean {
  return _deferredMCPSchemas !== null && _deferredMCPSchemas.size > 0;
}

/** Resolve full schemas for MCP tools by name (called by tool_search). */
export function resolveDeferredSchemas(toolNames: string[]): CodeBuddyTool[] {
  if (!_deferredMCPSchemas) return [];
  const map = _deferredMCPSchemas;
  return toolNames
    .map((name) => map.get(name))
    .filter((t): t is CodeBuddyTool => t !== undefined);
}
