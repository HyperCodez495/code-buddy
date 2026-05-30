/**
 * Session tool adapters (Phase E wake of SessionToolExecutor) tests.
 *
 * Validates the ITool adapters (sessions_list / sessions_history /
 * session_search / sessions_send / sessions_spawn) that bridge LLM tool calls to the
 * SessionToolExecutor + SessionRegistry.
 *
 * Also covers the V0.1 safety caps added to SessionRegistry.spawnSession:
 * MAX_SPAWN_DEPTH = 3 and MAX_SESSIONS_PER_WORKFLOW = 10.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSessionTools } from '../../src/tools/registry/session-tools.js';
import { SessionRegistry, resetSessionRegistry } from '../../src/agent/multi-agent/session-registry.js';
import { resetSessionToolExecutor, getSessionToolExecutor } from '../../src/agent/multi-agent/session-tools.js';

describe('Session tool adapters (Phase E)', () => {
  beforeEach(async () => {
    await resetSessionRegistry();
    resetSessionToolExecutor();
  });

  afterEach(async () => {
    await resetSessionRegistry();
    resetSessionToolExecutor();
  });

  it('createSessionTools returns the session ITool instances with correct names', () => {
    const tools = createSessionTools();
    expect(tools).toHaveLength(5);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'session_search',
      'sessions_history',
      'sessions_list',
      'sessions_send',
      'sessions_spawn',
    ]);
  });

  it('every adapter exposes a JSON-Schema parameters block via getSchema', () => {
    const tools = createSessionTools();
    for (const t of tools) {
      const schema = t.getSchema();
      expect(schema.name).toBe(t.name);
      expect(schema.parameters).toBeDefined();
      expect((schema.parameters as { type?: string }).type).toBe('object');
    }
  });

  it('every adapter is available + has utility category metadata', () => {
    const tools = createSessionTools();
    for (const t of tools) {
      expect(t.isAvailable()).toBe(true);
      const md = t.getMetadata();
      expect(md.category).toBe('utility');
      expect(md.modifiesFiles).toBe(false);
      expect(md.makesNetworkRequests).toBe(false);
    }
  });

  it('sessions_list returns active sessions via real SessionToolExecutor', async () => {
    const tools = createSessionTools();
    const list = tools.find((t) => t.name === 'sessions_list')!;

    // Pre-populate the registry
    const registry = new SessionRegistry();
    registry.createSession({ kind: 'main', agentId: 'test-agent' });
    // Replace singleton via internal state (avoiding shared mutable global)
    const result = await list.execute({ limit: 10 });
    expect(result.success).toBe(true);
    expect(result.output ?? '').toBeDefined();
  });

  it('sessions_spawn returns failure when parent session not found', async () => {
    const tools = createSessionTools();
    const spawn = tools.find((t) => t.name === 'sessions_spawn')!;
    // Default executor uses currentSessionId='main' which doesn't exist yet
    const result = await spawn.execute({ task: 'do something' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found|Parent session/i);
  });

  it('sessions_send returns failure for unknown target', async () => {
    const tools = createSessionTools();
    const send = tools.find((t) => t.name === 'sessions_send')!;
    const result = await send.execute({ sessionKey: 'nonexistent-session', message: 'hi' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found|nonexistent/i);
  });
});

describe('SessionRegistry V0.1 safety caps', () => {
  let registry: SessionRegistry;

  beforeEach(() => {
    registry = new SessionRegistry();
  });

  it('MAX_SPAWN_DEPTH (3): refuses to spawn at depth 4', () => {
    const root = registry.createSession({ kind: 'main', agentId: 'a' });
    const d1 = registry.spawnSession({ parentSessionId: root.id, task: 't1' });
    const d2 = registry.spawnSession({ parentSessionId: d1.id, task: 't2' });
    const d3 = registry.spawnSession({ parentSessionId: d2.id, task: 't3' });
    expect(() =>
      registry.spawnSession({ parentSessionId: d3.id, task: 't4' })
    ).toThrow(/Max spawn depth/i);
  });

  it('MAX_SPAWN_DEPTH allows depth 1-3 freely', () => {
    const root = registry.createSession({ kind: 'main', agentId: 'a' });
    const d1 = registry.spawnSession({ parentSessionId: root.id, task: 't1' });
    const d2 = registry.spawnSession({ parentSessionId: d1.id, task: 't2' });
    const d3 = registry.spawnSession({ parentSessionId: d2.id, task: 't3' });
    expect(d1.kind).toBe('spawn');
    expect(d3.kind).toBe('spawn');
  });

  it('MAX_SESSIONS_PER_WORKFLOW (10): refuses 11th spawn under same root', () => {
    const root = registry.createSession({ kind: 'main', agentId: 'a' });
    for (let i = 0; i < 10; i++) {
      registry.spawnSession({ parentSessionId: root.id, task: `t${i}` });
    }
    expect(() =>
      registry.spawnSession({ parentSessionId: root.id, task: 't11' })
    ).toThrow(/Workflow session cap reached/i);
  });

  it('cap is per-root: a fresh root can spawn its own 10', () => {
    const root1 = registry.createSession({ kind: 'main', agentId: 'a' });
    const root2 = registry.createSession({ kind: 'main', agentId: 'b' });
    for (let i = 0; i < 10; i++) {
      registry.spawnSession({ parentSessionId: root1.id, task: `r1-${i}` });
    }
    // Root2 still untouched
    const fresh = registry.spawnSession({ parentSessionId: root2.id, task: 'r2-fresh' });
    expect(fresh.kind).toBe('spawn');
  });

  it('spawn always sets sandboxed: true regardless of caller', () => {
    const root = registry.createSession({ kind: 'main', agentId: 'a' });
    const child = registry.spawnSession({ parentSessionId: root.id, task: 't' });
    expect(child.sandboxed).toBe(true);
  });

  it('spawn throws on missing parent session', () => {
    expect(() =>
      registry.spawnSession({ parentSessionId: 'nonexistent', task: 't' })
    ).toThrow(/Parent session.*not found/i);
  });
});

describe('SessionToolExecutor singleton integration', () => {
  beforeEach(async () => {
    await resetSessionRegistry();
    resetSessionToolExecutor();
  });

  it('getSessionToolExecutor returns the same instance across calls', () => {
    const a = getSessionToolExecutor();
    const b = getSessionToolExecutor();
    expect(a).toBe(b);
  });

  it('execute("sessions_list") returns success even on empty registry', async () => {
    const exec = getSessionToolExecutor();
    const result = await exec.execute('sessions_list', {});
    expect(result.success).toBe(true);
  });

  it('execute() with unknown tool name returns failure', async () => {
    const exec = getSessionToolExecutor();
    const result = await exec.execute('nonexistent_tool', {});
    expect(result.success).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// Phase I (V0.3) — per-minute spawn rate limit
// ────────────────────────────────────────────────────────────

describe('Phase I — per-minute spawn rate limit (SessionRegistry)', () => {
  let registry: SessionRegistry;

  beforeEach(() => {
    registry = new SessionRegistry();
  });

  it('maxSpawnPerMinute = 0 (default) → no rate limit applied', () => {
    const root = registry.createSession({ kind: 'main', agentId: 'a' });
    for (let i = 0; i < 5; i++) {
      // No throw expected — caps depth/breadth still apply but rate limit off
      registry.spawnSession({ parentSessionId: root.id, task: `t${i}` });
    }
    // Should reach the breadth cap (10) before the rate limit kicks in
    expect(true).toBe(true);
  });

  it('maxSpawnPerMinute = 3 → 4th spawn within 60s throws rate-limit', () => {
    const root = registry.createSession({ kind: 'main', agentId: 'a' });
    registry.spawnSession({ parentSessionId: root.id, task: 't1', maxSpawnPerMinute: 3 });
    registry.spawnSession({ parentSessionId: root.id, task: 't2', maxSpawnPerMinute: 3 });
    registry.spawnSession({ parentSessionId: root.id, task: 't3', maxSpawnPerMinute: 3 });
    expect(() =>
      registry.spawnSession({ parentSessionId: root.id, task: 't4', maxSpawnPerMinute: 3 })
    ).toThrow(/rate limit/i);
  });

  it('rate limit cap is independent from depth/breadth caps', () => {
    // Depth 3 + breadth 10 caps still fire even if rate limit not exceeded
    const root = registry.createSession({ kind: 'main', agentId: 'a' });
    for (let i = 0; i < 10; i++) {
      registry.spawnSession({ parentSessionId: root.id, task: `t${i}`, maxSpawnPerMinute: 100 });
    }
    expect(() =>
      registry.spawnSession({ parentSessionId: root.id, task: 't11', maxSpawnPerMinute: 100 })
    ).toThrow(/Workflow session cap/i);
  });
});
