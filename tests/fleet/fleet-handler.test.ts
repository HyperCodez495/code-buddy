/**
 * Phase (d).5 V0.4.1 — /fleet slash handler tests.
 *
 * Validates argument parsing, listener lifecycle (start/stop/status),
 * and error paths. The FleetListener class is mocked so tests don't
 * need a live WS server.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fleetListenerMock = vi.hoisted(() => {
  const connectMock = vi.fn(async () => undefined);
  const disconnectMock = vi.fn(async () => undefined);
  const onMock = vi.fn();
  const constructorCalls: Array<{ url: string; apiKey?: string; jwt?: string }> = [];
  // Phase (d).9 — presence telemetry. Default: never seen anything.
  // Tests that need a "seen" value override these via getLastSeenMock.mockReturnValueOnce(...).
  const getLastSeenMock = vi.fn(() => ({
    at: null as number | null,
    reason: null as string | null,
    ageMs: null as number | null,
  }));
  const isStaleMock = vi.fn(() => false);
  // Phase (d).10 — peer compaction telemetry. Default: never compacted.
  const getPeerCompactionStateMock = vi.fn(() => ({
    active: false as boolean,
    startedAt: null as number | null,
    ageMs: null as number | null,
    lastResult: null as null | {
      success?: boolean;
      originalTokens?: number;
      compactedTokens?: number;
      messagesRemoved?: number;
      strategy?: string;
      durationMs?: number;
      completedAt: number;
    },
  }));
  // Phase (d).11 — event history. Default: empty.
  const getEventHistoryMock = vi.fn<
    () => readonly { at: number; type: string; payload: Record<string, unknown>; hostname?: string; agentId?: string }[]
  >(() => []);

  class FleetListenerStub {
    constructor(opts: { url: string; apiKey?: string; jwt?: string }) {
      constructorCalls.push(opts);
    }
    connect = connectMock;
    disconnect = disconnectMock;
    on = onMock;
    isConnected = () => true;
    isAuthenticated = () => true;
    getReconnectAttempts = () => 0;
    isReconnecting = () => false;
    getLastSeen = getLastSeenMock;
    isStale = isStaleMock;
    getPeerCompactionState = getPeerCompactionStateMock;
    getEventHistory = getEventHistoryMock;
  }

  return {
    FleetListenerStub,
    connectMock,
    disconnectMock,
    onMock,
    constructorCalls,
    getLastSeenMock,
    isStaleMock,
    getPeerCompactionStateMock,
    getEventHistoryMock,
  };
});

vi.mock('../../src/fleet/fleet-listener.js', () => ({
  FleetListener: fleetListenerMock.FleetListenerStub,
}));

import {
  handleFleet,
  _resetFleetHandlerForTests,
} from '../../src/commands/handlers/fleet-handler.js';

describe('/fleet slash handler — Phase (d).5 V0.4.1', () => {
  beforeEach(() => {
    fleetListenerMock.constructorCalls.length = 0;
    fleetListenerMock.connectMock.mockReset().mockResolvedValue(undefined);
    fleetListenerMock.disconnectMock.mockReset().mockResolvedValue(undefined);
    fleetListenerMock.onMock.mockClear();
    fleetListenerMock.getLastSeenMock
      .mockReset()
      .mockReturnValue({ at: null, reason: null, ageMs: null });
    fleetListenerMock.isStaleMock.mockReset().mockReturnValue(false);
    fleetListenerMock.getPeerCompactionStateMock.mockReset().mockReturnValue({
      active: false,
      startedAt: null,
      ageMs: null,
      lastResult: null,
    });
    fleetListenerMock.getEventHistoryMock.mockReset().mockReturnValue([]);
    _resetFleetHandlerForTests();
    delete process.env.CODEBUDDY_FLEET_API_KEY;
  });

  afterEach(() => {
    _resetFleetHandlerForTests();
    delete process.env.CODEBUDDY_FLEET_API_KEY;
  });

  describe('help / status / unknown', () => {
    it('returns help when no action given', async () => {
      const r = await handleFleet([]);
      expect(r.entry?.content).toContain('No fleet listeners active');
      expect(r.entry?.content).toContain('/fleet');
    });

    it('returns help when help action given', async () => {
      const r = await handleFleet(['help']);
      expect(r.entry?.content).toContain('Usage: /fleet');
    });

    it('reports no active listener via status when nothing running', async () => {
      const r = await handleFleet(['status']);
      expect(r.entry?.content).toContain('No fleet listeners active');
    });

    it('handles unknown actions gracefully', async () => {
      const r = await handleFleet(['fubar']);
      expect(r.entry?.content).toContain('Unknown fleet action');
    });
  });

  describe('listen action', () => {
    it('rejects without ws-url', async () => {
      const r = await handleFleet(['listen']);
      expect(r.entry?.content).toContain('Usage:');
    });

    it('rejects without apiKey when env not set', async () => {
      const r = await handleFleet(['listen', 'ws://peer:3000/ws']);
      expect(r.entry?.content).toContain('no apiKey provided');
    });

    it('accepts apiKey via --api-key flag', async () => {
      const r = await handleFleet([
        'listen',
        'ws://peer:3000/ws',
        '--api-key',
        'cb_sk_abc',
      ]);
      expect(r.entry?.content).toContain('connected to');
      expect(fleetListenerMock.constructorCalls).toHaveLength(1);
      expect(fleetListenerMock.constructorCalls[0].url).toBe('ws://peer:3000/ws');
      expect(fleetListenerMock.constructorCalls[0].apiKey).toBe('cb_sk_abc');
    });

    it('accepts apiKey via CODEBUDDY_FLEET_API_KEY env', async () => {
      process.env.CODEBUDDY_FLEET_API_KEY = 'cb_sk_envkey';
      const r = await handleFleet(['listen', 'ws://peer:3000/ws']);
      expect(r.entry?.content).toContain('connected to');
      expect(fleetListenerMock.constructorCalls[0].apiKey).toBe('cb_sk_envkey');
    });

    it('--api-key flag takes precedence over env', async () => {
      process.env.CODEBUDDY_FLEET_API_KEY = 'cb_sk_env';
      const r = await handleFleet([
        'listen',
        'ws://peer:3000/ws',
        '--api-key',
        'cb_sk_cli',
      ]);
      expect(r.entry?.content).toContain('connected to');
      expect(fleetListenerMock.constructorCalls[0].apiKey).toBe('cb_sk_cli');
    });

    it('rejects when SAME peer name (or default-derived id) is already active', async () => {
      // Same URL → same default peer id → second listen rejects
      const r1 = await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k1']);
      expect(r1.entry?.content).toContain('connected');
      const r2 = await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k2']);
      expect(r2.entry?.content).toContain('is already active');
    });

    it('Phase (d).12 — accepts a SECOND listener to a different peer (different default id)', async () => {
      const r1 = await handleFleet(['listen', 'ws://peerA:3000/ws', '--api-key', 'k1']);
      expect(r1.entry?.content).toContain('connected');
      // Different host → different default id → accepted
      const r2 = await handleFleet(['listen', 'ws://peerB:3000/ws', '--api-key', 'k2']);
      expect(r2.entry?.content).toContain('connected');
      expect(fleetListenerMock.constructorCalls).toHaveLength(2);
    });

    it('Phase (d).12 — accepts two listeners to the SAME url with explicit --name overrides', async () => {
      const r1 = await handleFleet([
        'listen', 'ws://peer:3000/ws', '--api-key', 'k1', '--name', 'session-a',
      ]);
      expect(r1.entry?.content).toContain('"session-a"');
      const r2 = await handleFleet([
        'listen', 'ws://peer:3000/ws', '--api-key', 'k2', '--name', 'session-b',
      ]);
      expect(r2.entry?.content).toContain('"session-b"');
    });

    it('reports connect error', async () => {
      fleetListenerMock.connectMock.mockRejectedValueOnce(new Error('auth failed'));
      const r = await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'bad']);
      expect(r.entry?.content).toContain('connect failed');
      expect(r.entry?.content).toContain('auth failed');
    });

    it('subscribes to fleet:event + disconnected events', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const events = fleetListenerMock.onMock.mock.calls.map((c) => c[0]);
      expect(events).toContain('fleet:event');
      expect(events).toContain('disconnected');
      expect(events).toContain('error');
    });
  });

  describe('status after listen', () => {
    it('reports active listener with URL + uptime', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const r = await handleFleet(['status']);
      expect(r.entry?.content).toContain('1 active');
      expect(r.entry?.content).toContain('ws://peer:3000/ws');
      expect(r.entry?.content).toContain('Uptime');
    });

    it('Phase (d).12 — multi-peer status shows all active peers stacked', async () => {
      await handleFleet(['listen', 'ws://peerA:3000/ws', '--api-key', 'k1', '--name', 'a']);
      await handleFleet(['listen', 'ws://peerB:3000/ws', '--api-key', 'k2', '--name', 'b']);
      const r = await handleFleet(['status']);
      expect(r.entry?.content).toContain('2 active');
      expect(r.entry?.content).toContain('Peer "a"');
      expect(r.entry?.content).toContain('Peer "b"');
      expect(r.entry?.content).toContain('ws://peerA:3000/ws');
      expect(r.entry?.content).toContain('ws://peerB:3000/ws');
    });

    // Phase (d).9 — presence display in /fleet status.
    it('shows "Last seen: never" when no fleet event has been received yet', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const r = await handleFleet(['status']);
      expect(r.entry?.content).toContain('Last seen: never');
    });

    it('shows last-seen age + reason when the listener has received an event', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      fleetListenerMock.getLastSeenMock.mockReturnValueOnce({
        at: Date.now() - 5_000,
        reason: 'fleet:agent:tool_started',
        ageMs: 5_000,
      });
      const r = await handleFleet(['status']);
      expect(r.entry?.content).toContain('Last seen: 5s ago');
      expect(r.entry?.content).toContain('fleet:agent:tool_started');
      expect(r.entry?.content).not.toContain('⚠ stale');
    });

    it('prefixes the stale warning when isStale() returns true', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      fleetListenerMock.getLastSeenMock.mockReturnValueOnce({
        at: Date.now() - 120_000,
        reason: 'heartbeat',
        ageMs: 120_000,
      });
      fleetListenerMock.isStaleMock.mockReturnValueOnce(true);
      const r = await handleFleet(['status']);
      expect(r.entry?.content).toContain('⚠ stale');
      expect(r.entry?.content).toContain('Last seen: 120s ago');
      expect(r.entry?.content).toContain('heartbeat');
    });

    // Phase (d).10 — peer compaction lines.
    it('shows "⏸ Peer compacting" when peer compaction is active', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      fleetListenerMock.getPeerCompactionStateMock.mockReturnValueOnce({
        active: true,
        startedAt: Date.now() - 8_000,
        ageMs: 8_000,
        lastResult: null,
      });
      const r = await handleFleet(['status']);
      expect(r.entry?.content).toContain('⏸ Peer compacting');
      expect(r.entry?.content).toContain('started 8s ago');
    });

    it('shows "Last compaction" line with strategy + savings when not active', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      fleetListenerMock.getPeerCompactionStateMock.mockReturnValueOnce({
        active: false,
        startedAt: null,
        ageMs: null,
        lastResult: {
          success: true,
          originalTokens: 20_000,
          compactedTokens: 8_000,
          messagesRemoved: 18,
          strategy: 'hybrid',
          durationMs: 1234,
          completedAt: Date.now(),
        },
      });
      const r = await handleFleet(['status']);
      expect(r.entry?.content).toContain('Last compaction: hybrid in 1234ms');
      expect(r.entry?.content).toContain('saved 12000 tokens');
      expect(r.entry?.content).not.toContain('⏸ Peer compacting');
    });

    it('omits the compaction line entirely when no compaction has happened', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      // default mock: active=false, lastResult=null → no line
      const r = await handleFleet(['status']);
      expect(r.entry?.content).not.toContain('Peer compacting');
      expect(r.entry?.content).not.toContain('Last compaction');
    });
  });

  // ==========================================================================
  // Phase (d).11 — /fleet history slash action
  // ==========================================================================
  describe('history action (Phase (d).11)', () => {
    it('reports no listener when none active', async () => {
      const r = await handleFleet(['history']);
      expect(r.entry?.content).toContain('No fleet listeners active');
    });

    it('reports empty buffer when no events recorded', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const r = await handleFleet(['history']);
      expect(r.entry?.content).toContain('No fleet events recorded yet');
    });

    it('renders all events with HH:mm:ss + type when buffer has 3 entries', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      // Use a fixed reference epoch so the HH:mm:ss assertion is stable.
      const t0 = new Date('2026-05-03T10:15:30').getTime();
      fleetListenerMock.getEventHistoryMock.mockReturnValueOnce([
        {
          at: t0,
          type: 'fleet:agent:tool_started',
          payload: { tool: 'view_file', source: { hostname: 'darkstar', agentId: 'abcdef0123' } },
          hostname: 'darkstar',
          agentId: 'abcdef0123',
        },
        {
          at: t0 + 2000,
          type: 'fleet:peer:heartbeat',
          payload: { source: { hostname: 'darkstar' } },
          hostname: 'darkstar',
        },
        {
          at: t0 + 4000,
          type: 'fleet:workflow:start',
          payload: { workflowId: 'wf-x', source: { hostname: 'ministar' } },
          hostname: 'ministar',
        },
      ]);
      const r = await handleFleet(['history']);
      const out = r.entry?.content ?? '';
      expect(out).toContain('Fleet event history for "peer:3000" — last 3 of 3');
      expect(out).toContain('fleet:agent:tool_started');
      expect(out).toContain('tool=view_file');
      expect(out).toContain('[darkstar:abcdef01]');
      expect(out).toContain('fleet:peer:heartbeat');
      expect(out).toContain('(heartbeat)');
      expect(out).toContain('fleet:workflow:start');
      expect(out).toContain('workflowId=wf-x');
      expect(out).toContain('[ministar]');
      // Timestamps formatted HH:mm:ss
      expect(out).toMatch(/\[\d{2}:\d{2}:\d{2}\]/);
    });

    it('respects /fleet history N to limit the rendered count', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const t0 = Date.now();
      fleetListenerMock.getEventHistoryMock.mockReturnValueOnce([
        { at: t0, type: 'fleet:agent:tool_started', payload: { tool: 'a' } },
        { at: t0 + 1, type: 'fleet:agent:tool_started', payload: { tool: 'b' } },
        { at: t0 + 2, type: 'fleet:agent:tool_started', payload: { tool: 'c' } },
        { at: t0 + 3, type: 'fleet:agent:tool_started', payload: { tool: 'd' } },
      ]);
      const r = await handleFleet(['history', '2']);
      const out = r.entry?.content ?? '';
      expect(out).toContain('last 2 of 4');
      expect(out).toContain('tool=c');
      expect(out).toContain('tool=d');
      expect(out).not.toContain('tool=a');
      expect(out).not.toContain('tool=b');
    });

    it('summarizes compacting:complete with strategy + duration', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      fleetListenerMock.getEventHistoryMock.mockReturnValueOnce([
        {
          at: Date.now(),
          type: 'fleet:peer:compacting:complete',
          payload: { strategy: 'hybrid', durationMs: 1234, success: true },
        },
      ]);
      const r = await handleFleet(['history']);
      expect(r.entry?.content).toContain('(compacted: hybrid 1234ms)');
    });
  });

  describe('stop action', () => {
    it('reports nothing to stop when idle', async () => {
      const r = await handleFleet(['stop']);
      expect(r.entry?.content).toContain('No fleet listeners active to stop.');
    });

    it('disconnects active listener (single peer → no name needed)', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const r = await handleFleet(['stop']);
      expect(r.entry?.content).toContain('stopped');
      expect(fleetListenerMock.disconnectMock).toHaveBeenCalled();
    });

    it('clears active state so subsequent listen can re-connect', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k1']);
      await handleFleet(['stop']);
      const r2 = await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k2']);
      expect(r2.entry?.content).toContain('connected');
    });

    it('Phase (d).12 — multiple peers active + no name → demands a name', async () => {
      await handleFleet(['listen', 'ws://peerA:3000/ws', '--api-key', 'k1', '--name', 'a']);
      await handleFleet(['listen', 'ws://peerB:3000/ws', '--api-key', 'k2', '--name', 'b']);
      const r = await handleFleet(['stop']);
      expect(r.entry?.content).toContain('Multiple fleet listeners active');
      expect(fleetListenerMock.disconnectMock).not.toHaveBeenCalled();
    });

    it('Phase (d).12 — stop NAME stops the named peer only', async () => {
      await handleFleet(['listen', 'ws://peerA:3000/ws', '--api-key', 'k1', '--name', 'a']);
      await handleFleet(['listen', 'ws://peerB:3000/ws', '--api-key', 'k2', '--name', 'b']);
      const r = await handleFleet(['stop', 'a']);
      expect(r.entry?.content).toContain('"a" stopped');
      expect(fleetListenerMock.disconnectMock).toHaveBeenCalledTimes(1);
      const status = await handleFleet(['status']);
      expect(status.entry?.content).toContain('1 active');
      expect(status.entry?.content).toContain('Peer "b"');
    });

    it('Phase (d).12 — stop UNKNOWN_NAME reports error with active list', async () => {
      await handleFleet(['listen', 'ws://peerA:3000/ws', '--api-key', 'k1', '--name', 'a']);
      const r = await handleFleet(['stop', 'nonexistent']);
      expect(r.entry?.content).toContain('No fleet peer named "nonexistent"');
      expect(r.entry?.content).toContain('Active peers: a');
    });

    it('Phase (d).12 — stop --all disconnects every peer', async () => {
      await handleFleet(['listen', 'ws://peerA:3000/ws', '--api-key', 'k1', '--name', 'a']);
      await handleFleet(['listen', 'ws://peerB:3000/ws', '--api-key', 'k2', '--name', 'b']);
      const r = await handleFleet(['stop', '--all']);
      expect(r.entry?.content).toContain('stopped 2 listener(s)');
      expect(fleetListenerMock.disconnectMock).toHaveBeenCalledTimes(2);
      const status = await handleFleet(['status']);
      expect(status.entry?.content).toContain('No fleet listeners active');
    });
  });
});
