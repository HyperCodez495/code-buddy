/**
 * Phase (d).5 V0.4.1 — FleetListener client tests with mocked ws.
 *
 * Validates the connect/auth handshake, fleet:* event re-emission,
 * disconnect cleanup, and error paths.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// vi.hoisted runs before imports, so we can't use any imported value
// inside it. We hand-roll a minimal EventEmitter substitute here so the
// fake ws stays self-contained.
const wsMock = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  type FakeWS = {
    readonly url: string;
    readyState: number;
    sentMessages: string[];
    handlers: Map<string, Handler[]>;
    on(event: string, h: Handler): FakeWS;
    once(event: string, h: Handler): FakeWS;
    off(event: string, h: Handler): FakeWS;
    removeListener(event: string, h: Handler): FakeWS;
    emit(event: string, ...args: unknown[]): boolean;
    send(data: string): void;
    close(): void;
    open(): void;
    receive(msg: object): void;
    fail(err: Error): void;
  };

  const instances: FakeWS[] = [];

  class FakeWebSocket implements FakeWS {
    readyState = 0; // CONNECTING
    sentMessages: string[] = [];
    handlers = new Map<string, Handler[]>();
    constructor(public url: string) {
      instances.push(this);
    }
    on(event: string, h: Handler): this {
      const list = this.handlers.get(event) || [];
      list.push(h);
      this.handlers.set(event, list);
      return this;
    }
    once(event: string, h: Handler): this {
      const wrap: Handler = (...args) => {
        this.off(event, wrap);
        h(...args);
      };
      return this.on(event, wrap);
    }
    off(event: string, h: Handler): this {
      const list = this.handlers.get(event) || [];
      const i = list.indexOf(h);
      if (i >= 0) list.splice(i, 1);
      return this;
    }
    removeListener(event: string, h: Handler): this {
      return this.off(event, h);
    }
    emit(event: string, ...args: unknown[]): boolean {
      const list = [...(this.handlers.get(event) || [])];
      for (const h of list) h(...args);
      return list.length > 0;
    }
    send(data: string): void {
      this.sentMessages.push(data);
    }
    close(): void {
      this.readyState = 3; // CLOSED
      setImmediate(() => this.emit('close'));
    }
    open(): void {
      this.readyState = 1;
      this.emit('open');
    }
    receive(msg: object): void {
      this.emit('message', Buffer.from(JSON.stringify(msg)));
    }
    fail(err: Error): void {
      this.emit('error', err);
    }
  }
  return { FakeWebSocket, instances };
});

vi.mock('ws', () => ({
  WebSocket: wsMock.FakeWebSocket,
}));

import { FleetListener } from '../../src/fleet/fleet-listener.js';

describe('FleetListener — Phase (d).5 V0.4.1', () => {
  beforeEach(() => {
    wsMock.instances.length = 0;
  });

  afterEach(() => {
    wsMock.instances.length = 0;
  });

  describe('constructor', () => {
    it('throws without apiKey or jwt', () => {
      expect(
        () => new FleetListener({ url: 'ws://x/ws' }),
      ).toThrow(/requires apiKey or jwt/);
    });

    it('accepts apiKey', () => {
      expect(
        () => new FleetListener({ url: 'ws://x/ws', apiKey: 'k' }),
      ).not.toThrow();
    });

    it('accepts jwt', () => {
      expect(
        () => new FleetListener({ url: 'ws://x/ws', jwt: 't' }),
      ).not.toThrow();
    });
  });

  describe('connect handshake', () => {
    it('opens ws, sends authenticate after server connected msg, resolves on authenticated', async () => {
      const l = new FleetListener({ url: 'ws://peer/ws', apiKey: 'cb_sk_abc' });
      const connectPromise = l.connect();

      // Wait for the WebSocket constructor to be called
      await new Promise((r) => setImmediate(r));
      const fake = wsMock.instances[0];
      expect(fake).toBeDefined();
      expect(fake.url).toBe('ws://peer/ws');

      // Simulate server flow
      fake.open();
      await new Promise((r) => setImmediate(r));
      // Server sends 'connected' welcome
      fake.receive({ type: 'connected', payload: { connectionId: 'c1' } });
      await new Promise((r) => setImmediate(r));
      // Listener should have sent 'authenticate'
      expect(fake.sentMessages).toHaveLength(1);
      const sent = JSON.parse(fake.sentMessages[0]);
      expect(sent.type).toBe('authenticate');
      expect(sent.payload.apiKey).toBe('cb_sk_abc');

      // Server confirms auth
      fake.receive({ type: 'authenticated', payload: { keyId: 'k1', scopes: ['fleet:listen'] } });
      await connectPromise; // should resolve

      expect(l.isConnected()).toBe(true);
      expect(l.isAuthenticated()).toBe(true);

      await l.disconnect();
    });

    it('uses jwt token when provided', async () => {
      const l = new FleetListener({ url: 'ws://peer/ws', jwt: 'eyJ.test' });
      const connectPromise = l.connect();
      await new Promise((r) => setImmediate(r));
      const fake = wsMock.instances[0];

      fake.open();
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'connected' });
      await new Promise((r) => setImmediate(r));
      const sent = JSON.parse(fake.sentMessages[0]);
      expect(sent.payload.token).toBe('eyJ.test');

      fake.receive({ type: 'authenticated', payload: {} });
      await connectPromise;
      await l.disconnect();
    });

    it('rejects on auth error', async () => {
      const l = new FleetListener({ url: 'ws://peer/ws', apiKey: 'bad' });
      const connectPromise = l.connect();
      await new Promise((r) => setImmediate(r));
      const fake = wsMock.instances[0];

      fake.open();
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'connected' });
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'error', error: { code: 'AUTH_FAILED', message: 'Invalid credentials' } });

      await expect(connectPromise).rejects.toThrow(/Invalid credentials/);
    });

    it('rejects on connection close before auth', async () => {
      const l = new FleetListener({ url: 'ws://peer/ws', apiKey: 'k' });
      const connectPromise = l.connect();
      await new Promise((r) => setImmediate(r));
      const fake = wsMock.instances[0];

      fake.open();
      await new Promise((r) => setImmediate(r));
      // Close before the server's 'connected' message
      fake.emit('close');

      await expect(connectPromise).rejects.toThrow(/closed before authentication/);
    });

    it('rejects on ws error event', async () => {
      const l = new FleetListener({ url: 'ws://bad/ws', apiKey: 'k' });
      const connectPromise = l.connect();
      await new Promise((r) => setImmediate(r));
      const fake = wsMock.instances[0];

      fake.fail(new Error('ECONNREFUSED'));
      await expect(connectPromise).rejects.toThrow(/ECONNREFUSED/);
    });
  });

  describe('fleet event re-emission', () => {
    async function authenticated() {
      const l = new FleetListener({ url: 'ws://peer/ws', apiKey: 'k' });
      const cp = l.connect();
      await new Promise((r) => setImmediate(r));
      const fake = wsMock.instances[0];
      fake.open();
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'connected' });
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'authenticated', payload: {} });
      await cp;
      return { l, fake };
    }

    it('re-emits fleet:agent:tool_started events', async () => {
      const { l, fake } = await authenticated();
      const events: unknown[] = [];
      l.on('fleet:agent:tool_started', (p) => events.push(p));

      fake.receive({
        type: 'fleet:agent:tool_started',
        payload: { toolName: 'view_file', source: { hostname: 'darkstar' } },
      });

      expect(events).toHaveLength(1);
      const payload = events[0] as { toolName: string };
      expect(payload.toolName).toBe('view_file');

      await l.disconnect();
    });

    it('re-emits all fleet:* events on the generic fleet:event channel', async () => {
      const { l, fake } = await authenticated();
      const all: Array<{ type: string; payload: Record<string, unknown> }> = [];
      l.on('fleet:event', (e) => all.push(e));

      fake.receive({ type: 'fleet:agent:tool_started', payload: { toolName: 'a' } });
      fake.receive({ type: 'fleet:workflow:start', payload: { goal: 'g' } });
      fake.receive({ type: 'fleet:session:spawn', payload: { childSessionId: 'c1' } });

      expect(all).toHaveLength(3);
      expect(all.map((e) => e.type)).toEqual([
        'fleet:agent:tool_started',
        'fleet:workflow:start',
        'fleet:session:spawn',
      ]);

      await l.disconnect();
    });

    it('emits disconnected event on close', async () => {
      const { l, fake } = await authenticated();
      const closed: boolean[] = [];
      l.on('disconnected', () => closed.push(true));

      fake.emit('close');
      expect(closed).toHaveLength(1);
    });

    it('emits error event on ws error post-auth', async () => {
      const { l, fake } = await authenticated();
      const errors: Error[] = [];
      l.on('error', (e: Error) => errors.push(e));

      fake.fail(new Error('something bad'));
      expect(errors.length).toBeGreaterThanOrEqual(1);

      await l.disconnect();
    });
  });

  describe('disconnect', () => {
    it('closes the ws and resolves', async () => {
      const l = new FleetListener({ url: 'ws://peer/ws', apiKey: 'k' });
      const cp = l.connect();
      await new Promise((r) => setImmediate(r));
      const fake = wsMock.instances[0];
      fake.open();
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'connected' });
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'authenticated', payload: {} });
      await cp;

      await l.disconnect();
      expect(fake.readyState).toBe(3);
    });

    it('is idempotent (no-op when not connected)', async () => {
      const l = new FleetListener({ url: 'ws://peer/ws', apiKey: 'k' });
      await expect(l.disconnect()).resolves.toBeUndefined();
    });
  });
});
