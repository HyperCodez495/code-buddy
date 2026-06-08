/**
 * Gateway Tests
 */

import {
  GatewayServer,
  SessionManager,
  createMessage,
  createErrorMessage,
  getGatewayServer,
  resetGatewayServer,
  type GatewayMessage,
} from '../../src/gateway/index.js';

/** Exposes the protected connect/message lifecycle so the real handshake can be driven. */
class HandshakeTestGateway extends GatewayServer {
  connectClient(id: string): void {
    this.onConnect(id);
  }
  dispatch(id: string, msg: GatewayMessage, send: (m: GatewayMessage) => void): Promise<void> {
    return this.onMessage(id, msg, send);
  }
}

async function driveConnect(
  gateway: HandshakeTestGateway,
  clientId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  gateway.connectClient(clientId);
  let hello: Record<string, unknown> | undefined;
  await gateway.dispatch(clientId, createMessage('connect', payload), (m) => {
    if (m.type === 'hello_ok') hello = m.payload as Record<string, unknown>;
  });
  if (!hello) throw new Error('no hello_ok received');
  return hello;
}

describe('Gateway', () => {
  beforeEach(async () => {
    await resetGatewayServer();
  });

  afterEach(async () => {
    await resetGatewayServer();
  });

  describe('createMessage', () => {
    it('should create a gateway message', () => {
      const msg = createMessage('chat', { message: 'hello' }, 'session-1');

      expect(msg.type).toBe('chat');
      expect(msg.id).toBeDefined();
      expect(msg.sessionId).toBe('session-1');
      expect(msg.payload).toEqual({ message: 'hello' });
      expect(msg.timestamp).toBeGreaterThan(0);
    });

    it('should create message without session', () => {
      const msg = createMessage('ping', {});

      expect(msg.type).toBe('ping');
      expect(msg.sessionId).toBeUndefined();
    });
  });

  describe('createErrorMessage', () => {
    it('should create an error message', () => {
      const msg = createErrorMessage('AUTH_FAILED', 'Invalid token', { reason: 'expired' });

      expect(msg.type).toBe('error');
      expect(msg.payload.code).toBe('AUTH_FAILED');
      expect(msg.payload.message).toBe('Invalid token');
      expect(msg.payload.details).toEqual({ reason: 'expired' });
    });
  });

  describe('SessionManager', () => {
    let manager: SessionManager;

    beforeEach(() => {
      manager = new SessionManager();
    });

    it('should create sessions', () => {
      manager.createSession('session-1', { name: 'Test Session' });

      expect(manager.hasSession('session-1')).toBe(true);
      expect(manager.getSession('session-1')?.name).toBe('Test Session');
    });

    it('should not duplicate sessions', () => {
      manager.createSession('session-1');
      manager.createSession('session-1'); // Should not throw

      expect(manager.getAllSessions().length).toBe(1);
    });

    it('should add and remove clients', () => {
      manager.createSession('session-1');

      manager.addClient('session-1', 'client-1');
      manager.addClient('session-1', 'client-2');

      expect(manager.getClients('session-1')).toContain('client-1');
      expect(manager.getClients('session-1')).toContain('client-2');

      manager.removeClient('session-1', 'client-1');

      expect(manager.getClients('session-1')).not.toContain('client-1');
      expect(manager.getClients('session-1')).toContain('client-2');
    });

    it('should cleanup empty sessions', () => {
      manager.createSession('session-1');
      manager.createSession('session-2');
      manager.addClient('session-2', 'client-1');

      const removed = manager.cleanup();

      expect(removed).toBe(1);
      expect(manager.hasSession('session-1')).toBe(false);
      expect(manager.hasSession('session-2')).toBe(true);
    });

    it('should clear all sessions', () => {
      manager.createSession('session-1');
      manager.createSession('session-2');

      manager.clear();

      expect(manager.getAllSessions().length).toBe(0);
    });
  });

  describe('GatewayServer', () => {
    let server: GatewayServer;

    beforeEach(() => {
      server = new GatewayServer({ authEnabled: false });
    });

    afterEach(async () => {
      await server.stop();
    });

    it('should start and stop', async () => {
      expect(server.isRunning()).toBe(false);

      await server.start();
      expect(server.isRunning()).toBe(true);

      await server.stop();
      expect(server.isRunning()).toBe(false);
    });

    it('should register handlers', () => {
      let handlerCalled = false;

      server.registerHandler('chat', async () => {
        handlerCalled = true;
      });

      // Handler is registered (we can't easily test it without mocking the transport)
      server.unregisterHandler('chat');
    });

    it('should provide statistics', async () => {
      await server.start();

      const stats = server.getStats();

      expect(stats.running).toBe(true);
      expect(stats.clients).toBe(0);
      expect(stats.sessions).toBe(0);
      expect(stats.authenticatedClients).toBe(0);
    });
  });

  describe('connect -> hello_ok handshake', () => {
    it('enriches hello_ok with negotiated protocol, server identity, and capabilities', async () => {
      const gateway = new HandshakeTestGateway({ authEnabled: false });
      await gateway.start();
      const hello = await driveConnect(gateway, 'client-1', {
        deviceId: 'dev-1', deviceName: 'Test', role: 'control',
        protocolVersion: 1, minProtocolVersion: 1, maxProtocolVersion: 2,
      });
      await gateway.stop();

      expect(hello.protocolVersion).toBe(2);
      expect(hello.protocolCompatible).toBe(true);
      expect((hello.server as { connId: string }).connId).toBe('client-1');
      expect(typeof (hello.server as { version: string }).version).toBe('string');
      expect((hello.capabilities as { methods: string[] }).methods).toContain('connect');
      expect(hello.paired).toBe(true);
    });

    it('reports protocolCompatible:false and echoes the gateway version for a too-new client', async () => {
      const gateway = new HandshakeTestGateway({ authEnabled: false });
      await gateway.start();
      const hello = await driveConnect(gateway, 'client-old', {
        deviceId: 'dev-x', role: 'control', protocolVersion: 99,
      });
      await gateway.stop();

      expect(hello.protocolCompatible).toBe(false);
      expect(typeof hello.protocolVersion).toBe('number');
    });

    it('honours requirePairing in the paired flag (no longer a no-op)', async () => {
      const gateway = new HandshakeTestGateway({ authEnabled: false, requirePairing: true });
      await gateway.start();
      const hello = await driveConnect(gateway, 'client-2', {
        deviceId: 'dev-2', role: 'control', protocolVersion: 1,
      });
      await gateway.stop();

      expect(hello.paired).toBe(false);
    });
  });

  describe('Singleton', () => {
    it('should return same instance', () => {
      const server1 = getGatewayServer();
      const server2 = getGatewayServer();

      expect(server1).toBe(server2);
    });

    it('should reset instance', async () => {
      const server1 = getGatewayServer();
      await resetGatewayServer();
      const server2 = getGatewayServer();

      expect(server1).not.toBe(server2);
    });
  });
});
