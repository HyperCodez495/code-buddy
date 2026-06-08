import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GATEWAY_MIN_PROTOCOL_VERSION,
  GATEWAY_MAX_PROTOCOL_VERSION,
  buildHelloOkPayload,
  gatewayServerVersion,
  negotiateGatewayProtocol,
} from '../../src/gateway/protocol';

describe('negotiateGatewayProtocol', () => {
  it('honours a legacy single protocolVersion the gateway still supports', () => {
    expect(negotiateGatewayProtocol({ protocolVersion: 1 })).toEqual({
      protocolVersion: 1,
      compatible: true,
    });
  });

  it('picks the highest mutually-supported version from a client range', () => {
    expect(negotiateGatewayProtocol({ minProtocolVersion: 1, maxProtocolVersion: 2 })).toEqual({
      protocolVersion: 2,
      compatible: true,
    });
  });

  it('defaults an unspecified client to the gateway newest version', () => {
    expect(negotiateGatewayProtocol({})).toEqual({
      protocolVersion: GATEWAY_MAX_PROTOCOL_VERSION,
      compatible: true,
    });
  });

  it('reports incompatible and echoes the gateway preferred version when the client is too new', () => {
    expect(negotiateGatewayProtocol({ protocolVersion: 99 })).toEqual({
      protocolVersion: GATEWAY_MAX_PROTOCOL_VERSION,
      compatible: false,
    });
  });

  it('reports incompatible when the client max is below the gateway minimum', () => {
    const result = negotiateGatewayProtocol({ minProtocolVersion: -5, maxProtocolVersion: 0 });
    expect(result.compatible).toBe(false);
    expect(result.protocolVersion).toBe(GATEWAY_MAX_PROTOCOL_VERSION);
  });

  it('normalizes an inverted client range', () => {
    expect(negotiateGatewayProtocol({ minProtocolVersion: 2, maxProtocolVersion: 1 })).toEqual({
      protocolVersion: 2,
      compatible: true,
    });
  });

  it('respects an explicit narrower server range', () => {
    // Server that only speaks v1 negotiating with a v1-2 client picks v1.
    expect(negotiateGatewayProtocol({ minProtocolVersion: 1, maxProtocolVersion: 2 }, 1, 1)).toEqual({
      protocolVersion: 1,
      compatible: true,
    });
  });

  it('exposes a sane supported range', () => {
    expect(GATEWAY_MIN_PROTOCOL_VERSION).toBeLessThanOrEqual(GATEWAY_MAX_PROTOCOL_VERSION);
  });
});

describe('buildHelloOkPayload', () => {
  const base = {
    paired: true,
    uptime: 1234,
    stateVersion: 7,
    presence: [{ deviceId: 'd1', role: 'control', connectedAt: 1 }],
    health: { status: 'ok' as const, checkedAt: 9 },
    authRequired: false,
    negotiation: { protocolVersion: 2, compatible: true },
    serverVersion: '1.0.0-test',
    connId: 'conn-abc',
    methods: ['connect', 'auth', 'chat'],
  };

  it('surfaces the negotiated protocol, server identity, and sorted capabilities', () => {
    const hello = buildHelloOkPayload(base);
    expect(hello.protocolVersion).toBe(2);
    expect(hello.protocolCompatible).toBe(true);
    expect(hello.server).toEqual({ version: '1.0.0-test', connId: 'conn-abc' });
    expect(hello.capabilities.methods).toEqual(['auth', 'chat', 'connect']);
    expect(hello.paired).toBe(true);
    expect(hello.presence).toEqual(base.presence);
    expect(hello.authRequired).toBe(false);
  });

  it('deduplicates advertised methods', () => {
    const hello = buildHelloOkPayload({ ...base, methods: ['chat', 'chat', 'auth'] });
    expect(hello.capabilities.methods).toEqual(['auth', 'chat']);
  });

  it('omits challengeNonce unless provided', () => {
    expect(buildHelloOkPayload(base).challengeNonce).toBeUndefined();
    expect(buildHelloOkPayload({ ...base, challengeNonce: 'nonce-1' }).challengeNonce).toBe('nonce-1');
  });

  it('carries an incompatible negotiation through to the payload', () => {
    const hello = buildHelloOkPayload({
      ...base,
      negotiation: { protocolVersion: 2, compatible: false },
    });
    expect(hello.protocolCompatible).toBe(false);
  });
});

describe('gatewayServerVersion', () => {
  const original = process.env['CODEBUDDY_CLI_VERSION'];

  beforeEach(() => {
    delete process.env['CODEBUDDY_CLI_VERSION'];
  });

  afterEach(() => {
    if (original === undefined) delete process.env['CODEBUDDY_CLI_VERSION'];
    else process.env['CODEBUDDY_CLI_VERSION'] = original;
  });

  it('returns the CLI version when set', () => {
    process.env['CODEBUDDY_CLI_VERSION'] = '9.9.9';
    expect(gatewayServerVersion()).toBe('9.9.9');
  });

  it('falls back when the version env is absent', () => {
    expect(gatewayServerVersion()).toBe('0.0.0-dev');
  });
});
