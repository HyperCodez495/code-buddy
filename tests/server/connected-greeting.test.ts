import { describe, it, expect } from 'vitest';
import { buildConnectedGreeting } from '../../src/server/websocket/handler';

describe('buildConnectedGreeting', () => {
  const base = {
    connectionId: 'ws_1',
    authRequired: true,
    pairingRequired: false,
    serverVersion: '1.0.0-test',
    protocolVersion: 2,
    methods: ['chat', 'authenticate', 'ping'],
  };

  it('preserves the existing connectionId + authRequired fields (backward compatible)', () => {
    const greeting = buildConnectedGreeting(base);
    expect(greeting.type).toBe('connected');
    const payload = greeting.payload as Record<string, unknown>;
    expect(payload.connectionId).toBe('ws_1');
    expect(payload.authRequired).toBe(true);
  });

  it('advertises server identity, protocol, pairing, and sorted/deduped capabilities', () => {
    const greeting = buildConnectedGreeting({ ...base, pairingRequired: true, methods: ['chat', 'chat', 'authenticate', 'ping'] });
    const payload = greeting.payload as {
      server: { version: string };
      protocolVersion: number;
      pairingRequired: boolean;
      capabilities: { methods: string[] };
    };
    expect(payload.server).toEqual({ version: '1.0.0-test' });
    expect(payload.protocolVersion).toBe(2);
    expect(payload.pairingRequired).toBe(true);
    expect(payload.capabilities.methods).toEqual(['authenticate', 'chat', 'ping']);
  });
});
