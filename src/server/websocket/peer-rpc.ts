/**
 * Peer RPC registry (Phase (d).13 V0.4.1).
 *
 * Server-side handler for `peer:request` WS messages. Mirror of OpenClaw's
 * `node.invoke` pattern adapted for our mesh topology: any peer Code Buddy
 * can call any method on any other peer that exposes it, getting a typed
 * response back via `peer:response` keyed on the request id.
 *
 * Design choices:
 * - Method registry is module-level (one registry per process). Methods
 *   are registered by feature owners (e.g. `peer.describe` is registered
 *   here as a default; future modules can call `registerPeerMethod()`).
 * - Methods receive (params, ctx) and return a Promise. Throwing OR
 *   rejecting becomes an error response with `code='METHOD_ERROR'`.
 * - Permission gate: caller must hold the `peer:invoke` scope. This is
 *   enforced in handler.ts before routing here — this module just trusts
 *   the message arrived through the right scope.
 * - Default methods exposed at boot: `peer.describe`, `peer.ping`,
 *   `peer.echo` (last one is for connectivity smoke tests).
 * - Caller-side timeout / cancel logic lives in FleetListener.request()
 *   on the OTHER end. Server processes synchronously and responds.
 */

import os from 'os';
import { logger } from '../../utils/logger.js';

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────

/**
 * Server-side handler context passed to method implementations.
 * Includes connection id for audit logs and the originating client's
 * scopes for permission-aware methods.
 */
export interface PeerMethodContext {
  /** WS connection id of the caller. */
  connectionId: string;
  /** Scopes held by the caller's authenticated session. */
  scopes: string[];
}

/** Method handler signature. Async, returns the JSON-serializable payload. */
export type PeerMethodHandler = (
  params: Record<string, unknown>,
  ctx: PeerMethodContext,
) => Promise<unknown>;

/** Request frame received over WS (peer:request type). */
export interface PeerRequestFrame {
  /** Caller-generated request id (uuid). */
  id: string;
  /** Dotted method name, e.g. "peer.describe". */
  method: string;
  /** Method params (method-specific shape). */
  params?: Record<string, unknown>;
}

/** Response frame sent back over WS (peer:response type). */
export interface PeerResponseFrame {
  /** Echoed request id for correlation. */
  id: string;
  /** True on success, false on any error. */
  ok: boolean;
  /** Result payload when ok=true. */
  payload?: unknown;
  /** Error info when ok=false. */
  error?: { code: string; message: string };
}

// ──────────────────────────────────────────────────────────────────
// Registry
// ──────────────────────────────────────────────────────────────────

const handlers = new Map<string, PeerMethodHandler>();

/**
 * Register a peer method handler. Idempotent for the same (method,
 * handler) pair; replaces silently if a different handler is registered
 * for the same method (last-wins, mirror of express middleware).
 */
export function registerPeerMethod(method: string, handler: PeerMethodHandler): void {
  handlers.set(method, handler);
  logger.debug(`[peer-rpc] registered method: ${method}`);
}

/** Unregister a method (test cleanup, plugin hot-reload). */
export function unregisterPeerMethod(method: string): void {
  handlers.delete(method);
}

/** List currently-registered method names. */
export function listPeerMethods(): string[] {
  return [...handlers.keys()].sort();
}

/** Test-only reset hook. Removes all methods, including built-ins. */
export function _resetPeerRpcForTests(): void {
  handlers.clear();
  // Re-register the built-ins so tests don't have to know about them.
  registerBuiltInMethods();
}

// ──────────────────────────────────────────────────────────────────
// Built-in methods
// ──────────────────────────────────────────────────────────────────

/**
 * Register the default peer methods: describe, ping, echo. Called once
 * at module load below. Plugins can override by re-registering with the
 * same method name.
 */
function registerBuiltInMethods(): void {
  // peer.describe — return basic identity + list of registered methods.
  // Mirror of OpenClaw node.describe but with method-list discovery
  // baked in (we don't have a Capabilities enum yet — just expose what
  // we can answer).
  registerPeerMethod('peer.describe', async () => ({
    hostname: process.env.CODEBUDDY_FLEET_HOSTNAME || os.hostname(),
    pid: process.pid,
    methods: listPeerMethods(),
    apiVersion: 'd.13',
  }));

  // peer.ping — minimal connectivity check. Echoes a server-side
  // timestamp so the caller can measure round-trip latency.
  registerPeerMethod('peer.ping', async () => ({
    pong: true,
    serverTime: Date.now(),
  }));

  // peer.echo — debugging aid. Returns the params verbatim. Useful for
  // smoke-testing the request/response loop without depending on any
  // other method's semantics.
  registerPeerMethod('peer.echo', async (params) => ({ echoed: params }));
}

registerBuiltInMethods();

// ──────────────────────────────────────────────────────────────────
// Dispatch
// ──────────────────────────────────────────────────────────────────

/**
 * Route a `peer:request` frame to its handler and return the response
 * frame. Never throws — all error paths produce a structured error
 * response. The caller (handler.ts) just sends what we return.
 */
export async function dispatchPeerRequest(
  frame: PeerRequestFrame,
  ctx: PeerMethodContext,
): Promise<PeerResponseFrame> {
  // Validate request shape
  if (!frame.id || typeof frame.id !== 'string') {
    return {
      id: frame.id ?? 'unknown',
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'request id missing or not a string' },
    };
  }
  if (!frame.method || typeof frame.method !== 'string') {
    return {
      id: frame.id,
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'method missing or not a string' },
    };
  }
  const handler = handlers.get(frame.method);
  if (!handler) {
    return {
      id: frame.id,
      ok: false,
      error: { code: 'UNKNOWN_METHOD', message: `no handler registered for "${frame.method}"` },
    };
  }
  try {
    const payload = await handler(frame.params ?? {}, ctx);
    return { id: frame.id, ok: true, payload };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.debug(`[peer-rpc] method "${frame.method}" threw`, { error: message });
    return {
      id: frame.id,
      ok: false,
      error: { code: 'METHOD_ERROR', message },
    };
  }
}
