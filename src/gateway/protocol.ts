/**
 * Gateway handshake protocol helpers.
 *
 * Pure, dependency-free logic for the `connect` -> `hello_ok` handshake so it can
 * be unit-tested without spinning up a WebSocket server. Inspired by the OpenClaw
 * gateway (min/max protocol negotiation, `protocol` echo, `server.{version,connId}`,
 * `features.methods` capability advertisement) and Hermes' capability discovery.
 */

import type { HelloOkPayload } from './types.js';

/** Lowest protocol version this gateway still accepts from a client. */
export const GATEWAY_MIN_PROTOCOL_VERSION = 1;
/** Preferred / newest protocol version this gateway speaks. */
export const GATEWAY_PROTOCOL_VERSION = 2;
/** Highest protocol version this gateway can negotiate. */
export const GATEWAY_MAX_PROTOCOL_VERSION = GATEWAY_PROTOCOL_VERSION;

export interface ProtocolNegotiationInput {
  /** Client's preferred protocol version (legacy single-value field). */
  protocolVersion?: number;
  /** Client's minimum acceptable protocol version. */
  minProtocolVersion?: number;
  /** Client's maximum acceptable protocol version. */
  maxProtocolVersion?: number;
}

export interface ProtocolNegotiationResult {
  /** The version the gateway will speak on this connection. */
  protocolVersion: number;
  /** True when the client's requested range overlaps the gateway's. */
  compatible: boolean;
}

function asFiniteInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

/**
 * Negotiate a protocol version against the gateway's supported range.
 *
 * - A client that declares a `[min, max]` range gets the highest version in the
 *   overlap with `[serverMin, serverMax]`.
 * - A legacy client that only sends `protocolVersion` is honoured at that exact
 *   version when the gateway still supports it.
 * - A client that declares nothing defaults to the gateway's newest version.
 * - When there is no overlap the gateway reports `compatible: false` and echoes
 *   its own preferred version so the client can adapt or refuse.
 */
export function negotiateGatewayProtocol(
  client: ProtocolNegotiationInput = {},
  serverMin: number = GATEWAY_MIN_PROTOCOL_VERSION,
  serverMax: number = GATEWAY_MAX_PROTOCOL_VERSION,
): ProtocolNegotiationResult {
  const preferred = asFiniteInt(client.protocolVersion);
  const clientMinRaw = asFiniteInt(client.minProtocolVersion) ?? preferred ?? serverMin;
  const clientMaxRaw = asFiniteInt(client.maxProtocolVersion) ?? preferred ?? serverMax;
  const clientMin = Math.min(clientMinRaw, clientMaxRaw);
  const clientMax = Math.max(clientMinRaw, clientMaxRaw);

  const overlapLow = Math.max(serverMin, clientMin);
  const overlapHigh = Math.min(serverMax, clientMax);

  if (overlapLow <= overlapHigh) {
    return { protocolVersion: overlapHigh, compatible: true };
  }
  return { protocolVersion: serverMax, compatible: false };
}

/** Resolve the running server version (set from package.json by the CLI bootstrap). */
export function gatewayServerVersion(): string {
  return process.env['CODEBUDDY_CLI_VERSION'] || '0.0.0-dev';
}

export interface HelloOkBuildParams {
  paired: boolean;
  uptime: number;
  stateVersion: number;
  presence: HelloOkPayload['presence'];
  health: HelloOkPayload['health'];
  authRequired: boolean;
  negotiation: ProtocolNegotiationResult;
  serverVersion: string;
  /** Stable per-connection id (mirrors OpenClaw's `server.connId`). */
  connId: string;
  /** Handler/method names the gateway advertises for capability discovery. */
  methods: string[];
  challengeNonce?: string;
}

/**
 * Assemble the enriched `hello_ok` payload. Pure so the exact shape (negotiated
 * protocol, server identity, advertised capabilities) can be asserted in tests.
 */
export function buildHelloOkPayload(params: HelloOkBuildParams): HelloOkPayload {
  return {
    paired: params.paired,
    ...(params.challengeNonce ? { challengeNonce: params.challengeNonce } : {}),
    uptime: params.uptime,
    stateVersion: params.stateVersion,
    presence: params.presence,
    health: params.health,
    authRequired: params.authRequired,
    protocolVersion: params.negotiation.protocolVersion,
    protocolCompatible: params.negotiation.compatible,
    server: { version: params.serverVersion, connId: params.connId },
    capabilities: { methods: [...new Set(params.methods)].sort() },
  };
}
