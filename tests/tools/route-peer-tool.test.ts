/**
 * route_peer tool tests.
 *
 * Verifies the LLM-facing wrapper around Fleet TaskRouter without real
 * WebSocket traffic. The registry contains stub listeners whose
 * peer.describe responses advertise synthetic provider capabilities.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { executeRoutePeer } from '../../src/tools/route-peer-tool.js';
import {
  getFleetRegistry,
  _resetFleetRegistryForTests,
  type ActiveListenerEntry,
  type FleetListenerPublicAPI,
} from '../../src/fleet/fleet-registry.js';
import type { PeerCapability } from '../../src/fleet/types.js';

function makeStubListener(
  capability: PeerCapability | null,
  error?: Error,
): FleetListenerPublicAPI {
  return {
    disconnect: async () => undefined,
    getReconnectAttempts: () => 0,
    isReconnecting: () => false,
    request: async (method) => {
      expect(method).toBe('peer.describe');
      if (error) throw error;
      return { capabilities: capability };
    },
    getLastSeen: () => ({ at: Date.now(), reason: 'test', ageMs: 10 }),
    isStale: () => false,
    getPeerCompactionState: () => ({
      active: false,
      startedAt: null,
      ageMs: null,
      lastResult: null,
    }),
    getEventHistory: () => [],
  };
}

function registerPeer(id: string, capability: PeerCapability | null, error?: Error): void {
  const entry: ActiveListenerEntry = {
    id,
    url: `ws://example/${id}`,
    startedAt: new Date(),
    eventCount: 0,
    autoReconnect: false,
    maxAttempts: 5,
    listener: makeStubListener(capability, error),
  };
  getFleetRegistry().register(entry);
}

function capability(partial: Partial<PeerCapability>): PeerCapability {
  return {
    models: [],
    egress: 'local',
    machineLabel: 'test',
    ...partial,
  };
}

describe('route_peer tool', () => {
  beforeEach(() => {
    _resetFleetRegistryForTests();
  });

  it('errors when no peers are connected', async () => {
    const result = await executeRoutePeer({ prompt: 'analyze this architecture' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('No fleet peers connected');
  });

  it('routes reasoning-heavy public tasks to the strongest ChatGPT OAuth peer', async () => {
    registerPeer(
      'chatgpt-pro',
      capability({
        egress: 'cloud',
        models: [
          {
            id: 'gpt-5.1-codex',
            contextWindow: 200_000,
            strengths: ['reasoning', 'thinking', 'code'],
            provider: 'chatgpt-oauth',
          },
        ],
      }),
    );
    registerPeer(
      'ollama-box',
      capability({
        egress: 'local',
        models: [
          {
            id: 'qwen3.6:35b',
            contextWindow: 32_000,
            strengths: ['reasoning'],
            provider: 'ollama',
          },
        ],
      }),
    );

    const result = await executeRoutePeer({
      prompt: 'think deeply and analyze this multi-agent architecture',
      privacyTag: 'public',
    });

    expect(result.success).toBe(true);
    const data = result.data as {
      recommendation: { peer: string; model: string };
      nextCall: { tool: string; args: { peer: string; model: string } };
    };
    expect(data.recommendation).toMatchObject({
      peer: 'chatgpt-pro',
      model: 'gpt-5.1-codex',
    });
    expect(data.nextCall).toEqual({
      tool: 'peer_delegate',
      args: {
        peer: 'chatgpt-pro',
        prompt: 'think deeply and analyze this multi-agent architecture',
        model: 'gpt-5.1-codex',
      },
    });
  });

  it('vetoes cloud peers when privacyTag is sensitive', async () => {
    registerPeer(
      'chatgpt-pro',
      capability({
        egress: 'cloud',
        models: [
          {
            id: 'gpt-5.1-codex',
            contextWindow: 200_000,
            strengths: ['reasoning', 'thinking'],
            provider: 'chatgpt-oauth',
          },
        ],
      }),
    );
    registerPeer(
      'local-ollama',
      capability({
        egress: 'local',
        models: [
          {
            id: 'qwen3.6:35b',
            contextWindow: 32_000,
            strengths: ['reasoning', 'thinking'],
            provider: 'ollama',
          },
        ],
      }),
    );

    const result = await executeRoutePeer({
      prompt: 'think through this private codebase bug',
      privacyTag: 'sensitive',
    });

    expect(result.success).toBe(true);
    expect((result.data as { recommendation: { peer: string } }).recommendation.peer).toBe(
      'local-ollama',
    );
  });

  it('returns describe errors when no peer exposes capabilities', async () => {
    registerPeer('listen-only', null, new Error('FORBIDDEN: peer:invoke scope required'));

    const result = await executeRoutePeer({ prompt: 'where should this run?' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('No connected peer exposed routable capabilities');
    expect((result.data as { describeErrors: Array<{ peer: string; error: string }> }).describeErrors)
      .toEqual([
        {
          peer: 'listen-only',
          error: 'FORBIDDEN: peer:invoke scope required',
        },
      ]);
  });
});
