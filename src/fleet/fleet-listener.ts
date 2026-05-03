/**
 * Fleet listener client (Phase (d).5 V0.4.1).
 *
 * Connects to a peer Code Buddy's Gateway WebSocket and subscribes to
 * fleet:* events broadcast by that instance. Closes the streaming loop
 * started by (d).1 — the broadcast surface — by giving users an actual
 * way to consume events from another Claude.
 *
 * Authentication:
 * Uses the existing apiKey path on the peer's Gateway WS handler. The
 * apiKey must have the `fleet:listen` scope (added in (d).1).
 *
 * Lifecycle:
 *   const l = new FleetListener({ url, apiKey });
 *   l.on('fleet:agent:tool_started', (payload) => ...);
 *   await l.connect();      // resolves on 'authenticated'
 *   ...
 *   await l.disconnect();   // closes ws cleanly
 *
 * Reconnect: V0.4.1 does NOT auto-reconnect. If the peer drops, callers
 * receive a `disconnected` event and decide what to do. Auto-reconnect
 * with exponential backoff is V0.5+ — keeping (d).5 narrow.
 *
 * Event surface (re-emitted from incoming WS messages):
 * - `fleet:agent:tool_started`, `fleet:agent:tool_completed`,
 *   `fleet:agent:tool_error` (from peer's (d).2)
 * - `fleet:workflow:start`, `fleet:workflow:event`,
 *   `fleet:workflow:complete` (from peer's (d).3)
 * - `fleet:session:spawn`, `fleet:session:message` (from peer's (d).4)
 * - `connected`, `authenticated`, `disconnected`, `error` (lifecycle)
 *
 * Honest limitations:
 * - No backpressure on the receive side either; if local handlers are
 *   slow, ws lib buffers. (d).6 / V0.5 add per-event-type queue caps.
 * - Cross-host trust model: caller picks the apiKey provisioning path.
 *   Hub-issued keys vs. per-spoke keys vs. shared keys all work; pick
 *   based on operational needs.
 */

import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import { logger } from '../utils/logger.js';

export interface FleetListenerOptions {
  /** Peer Gateway WS URL, e.g. ws://100.98.18.76:3000/ws */
  url: string;
  /** API key with `fleet:listen` scope on the peer. Either this or jwt. */
  apiKey?: string;
  /** JWT token alternative to apiKey. */
  jwt?: string;
  /** Optional connection timeout in ms (default 10_000). */
  connectTimeoutMs?: number;
  /** Optional auth timeout in ms once connected (default 5_000). */
  authTimeoutMs?: number;
}

interface IncomingMessage {
  type: string;
  payload?: Record<string, unknown>;
  error?: { code: string; message: string };
  timestamp?: string;
}

export class FleetListener extends EventEmitter {
  private ws: WebSocket | null = null;
  private connected = false;
  private authenticated = false;
  private readonly options: FleetListenerOptions;

  constructor(options: FleetListenerOptions) {
    super();
    if (!options.apiKey && !options.jwt) {
      throw new Error('FleetListener requires apiKey or jwt');
    }
    this.options = options;
    // Default 'error' listener — EventEmitter throws synchronously when
    // 'error' is emitted with no listener registered, which would crash
    // the calling agent on a transient WS hiccup. Callers can still
    // listener.on('error', ...) for their own handling.
    this.on('error', () => {
      /* noop default — keep node from throwing on unhandled error */
    });
  }

  /**
   * Connect to the peer and authenticate. Resolves once the server
   * sends `authenticated`. Rejects on connect error, auth error, or
   * timeout. After this call, `connected` and `authenticated` flags
   * are true and incoming fleet:* messages are re-emitted as events.
   */
  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (err?: unknown) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };

      const connectTimer = setTimeout(() => {
        settle(new Error(`Fleet listener connect timeout (${this.options.connectTimeoutMs ?? 10_000}ms)`));
        try {
          this.ws?.close();
        } catch {
          /* ignore */
        }
      }, this.options.connectTimeoutMs ?? 10_000);

      let authTimer: NodeJS.Timeout | null = null;

      this.ws = new WebSocket(this.options.url);

      this.ws.on('open', () => {
        clearTimeout(connectTimer);
        this.connected = true;
        this.emit('connected');
      });

      this.ws.on('message', (data) => {
        let msg: IncomingMessage;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          this.emit('error', new Error('Received non-JSON message'));
          return;
        }
        this.handleIncomingMessage(msg, settle, () => {
          if (authTimer) {
            clearTimeout(authTimer);
            authTimer = null;
          }
        });
      });

      this.ws.on('close', () => {
        if (authTimer) clearTimeout(authTimer);
        clearTimeout(connectTimer);
        this.connected = false;
        this.authenticated = false;
        this.emit('disconnected');
        // If we never settled, the connection died before auth — reject.
        settle(new Error('Connection closed before authentication'));
      });

      this.ws.on('error', (err) => {
        clearTimeout(connectTimer);
        if (authTimer) clearTimeout(authTimer);
        this.emit('error', err);
        settle(err instanceof Error ? err : new Error(String(err)));
      });

      // After 'connected' from the server, send the auth message. Set up
      // an auth timeout in case the server never responds.
      this.once('connected', () => {
        // 'connected' here is OUR emitted event when ws opened; we still
        // need to wait for the SERVER's 'connected' message. The
        // handleIncomingMessage path does the auth-send — see below.
      });

      // Bound auth wait: schedule the timeout after we send authenticate.
      // We'll trigger this from handleIncomingMessage after sending auth.
      this.once('__internal:auth-sent', () => {
        authTimer = setTimeout(() => {
          settle(new Error(`Fleet listener auth timeout (${this.options.authTimeoutMs ?? 5_000}ms)`));
          try {
            this.ws?.close();
          } catch {
            /* ignore */
          }
        }, this.options.authTimeoutMs ?? 5_000);
      });
    });
  }

  private handleIncomingMessage(
    msg: IncomingMessage,
    settle: (err?: unknown) => void,
    clearAuthTimer: () => void,
  ): void {
    // Server's welcome → send authenticate.
    if (msg.type === 'connected') {
      const auth: Record<string, unknown> = {};
      if (this.options.apiKey) auth.apiKey = this.options.apiKey;
      if (this.options.jwt) auth.token = this.options.jwt;
      this.send('authenticate', auth);
      this.emit('__internal:auth-sent');
      return;
    }
    if (msg.type === 'authenticated') {
      this.authenticated = true;
      clearAuthTimer();
      this.emit('authenticated', msg.payload);
      settle();
      return;
    }
    if (msg.type === 'error') {
      const err = new Error(msg.error?.message || 'Server error');
      (err as Error & { code?: string }).code = msg.error?.code;
      this.emit('error', err);
      // If we haven't authenticated yet, the error is fatal for connect()
      if (!this.authenticated) {
        settle(err);
      }
      return;
    }
    // Fleet event re-emit. We forward type + payload as-is so consumers
    // can pattern-match on 'fleet:agent:tool_started' etc.
    if (msg.type.startsWith('fleet:')) {
      this.emit(msg.type, msg.payload ?? {});
      // Also emit on a generic 'fleet:event' channel so callers can
      // subscribe to all events at once for logging / debugging.
      this.emit('fleet:event', { type: msg.type, payload: msg.payload ?? {} });
      return;
    }
    // Anything else — log + forward verbatim. The peer might add new
    // message types we don't yet model.
    this.emit(msg.type, msg.payload ?? {});
  }

  private send(type: string, payload?: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== 1 /* OPEN */) {
      logger.debug('[fleet-listener] tried to send on non-open ws', { type });
      return;
    }
    this.ws.send(JSON.stringify({ type, payload }));
  }

  /** Close the WS connection. Idempotent. */
  async disconnect(): Promise<void> {
    if (!this.ws) return;
    return new Promise<void>((resolve) => {
      const ws = this.ws;
      if (!ws) {
        resolve();
        return;
      }
      const onClose = () => {
        ws.removeListener('close', onClose);
        resolve();
      };
      ws.on('close', onClose);
      try {
        ws.close();
      } catch {
        // close() should never throw on a valid ws but guard anyway
        resolve();
      }
      // Safety net — close should fire 'close' but if for some reason it
      // doesn't, resolve after 1s so callers don't hang forever.
      setTimeout(resolve, 1000);
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }
}
