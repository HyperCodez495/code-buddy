/**
 * Deferred MCP-schema state — the module extracted to break the
 * tools.ts ↔ tool-search.ts cycle. Round-trips set/get/resolve.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  getDeferredMCPSchemas,
  isDeferredSchemaMode,
  resolveDeferredSchemas,
  setDeferredMCPSchemas,
} from '../../src/tools/deferred-schema-state.js';
import type { CodeBuddyTool } from '../../src/codebuddy/client.js';

const tool = (name: string): CodeBuddyTool => ({
  type: 'function',
  function: { name, description: `${name} desc`, parameters: { type: 'object', properties: {} } },
});

afterEach(() => setDeferredMCPSchemas(null));

describe('deferred-schema-state', () => {
  it('is off by default', () => {
    setDeferredMCPSchemas(null);
    expect(isDeferredSchemaMode()).toBe(false);
    expect(getDeferredMCPSchemas().size).toBe(0);
    expect(resolveDeferredSchemas(['x'])).toEqual([]);
  });

  it('stores and resolves full schemas by name', () => {
    const map = new Map([['mcp__a', tool('mcp__a')], ['mcp__b', tool('mcp__b')]]);
    setDeferredMCPSchemas(map);
    expect(isDeferredSchemaMode()).toBe(true);
    expect(getDeferredMCPSchemas().size).toBe(2);
    const resolved = resolveDeferredSchemas(['mcp__b', 'missing']);
    expect(resolved.map((t) => t.function.name)).toEqual(['mcp__b']);
  });

  it('clearing with null turns deferred mode off', () => {
    setDeferredMCPSchemas(new Map([['x', tool('x')]]));
    expect(isDeferredSchemaMode()).toBe(true);
    setDeferredMCPSchemas(null);
    expect(isDeferredSchemaMode()).toBe(false);
  });
});
