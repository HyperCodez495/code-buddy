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

  class FleetListenerStub {
    constructor(opts: { url: string; apiKey?: string; jwt?: string }) {
      constructorCalls.push(opts);
    }
    connect = connectMock;
    disconnect = disconnectMock;
    on = onMock;
    isConnected = () => true;
    isAuthenticated = () => true;
  }

  return { FleetListenerStub, connectMock, disconnectMock, onMock, constructorCalls };
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
      expect(r.entry?.content).toContain('No fleet listener active');
      expect(r.entry?.content).toContain('/fleet');
    });

    it('returns help when help action given', async () => {
      const r = await handleFleet(['help']);
      expect(r.entry?.content).toContain('Usage: /fleet');
    });

    it('reports no active listener via status when nothing running', async () => {
      const r = await handleFleet(['status']);
      expect(r.entry?.content).toContain('No fleet listener active');
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

    it('rejects when listener already active', async () => {
      const r1 = await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k1']);
      expect(r1.entry?.content).toContain('connected');
      const r2 = await handleFleet(['listen', 'ws://other:3000/ws', '--api-key', 'k2']);
      expect(r2.entry?.content).toContain('already active');
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
      expect(r.entry?.content).toContain('ACTIVE');
      expect(r.entry?.content).toContain('ws://peer:3000/ws');
      expect(r.entry?.content).toContain('Uptime');
    });
  });

  describe('stop action', () => {
    it('reports nothing to stop when idle', async () => {
      const r = await handleFleet(['stop']);
      expect(r.entry?.content).toContain('No fleet listener active');
    });

    it('disconnects active listener', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const r = await handleFleet(['stop']);
      expect(r.entry?.content).toContain('Fleet listener stopped');
      expect(fleetListenerMock.disconnectMock).toHaveBeenCalled();
    });

    it('clears active state so subsequent listen can re-connect', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k1']);
      await handleFleet(['stop']);
      const r2 = await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k2']);
      expect(r2.entry?.content).toContain('connected');
    });
  });
});
