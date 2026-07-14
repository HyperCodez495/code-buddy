import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { type WebSocketServer } from 'ws';

interface MockAgentRecord {
  abortCurrentOperation: ReturnType<typeof vi.fn>;
  finalized: boolean;
  release?: () => void;
}

const agentMockState = vi.hoisted(() => ({
  records: [] as MockAgentRecord[],
}));

vi.mock('../../src/server/agent-adapter.js', () => ({
  createServerAgent: vi.fn(async () => {
    const record: MockAgentRecord = {
      abortCurrentOperation: vi.fn(),
      finalized: false,
    };
    record.abortCurrentOperation.mockImplementation(() => {
      const release = record.release;
      record.release = undefined;
      release?.();
    });

    const processUserMessageStream = vi.fn(async function* () {
      try {
        yield { type: 'content', content: 'partial' };
        await new Promise<void>((resolve) => {
          record.release = resolve;
        });
        yield { type: 'content', content: 'late' };
      } finally {
        record.finalized = true;
      }
    });

    agentMockState.records.push(record);
    return {
      processUserMessage: vi.fn(async () => []),
      processUserMessageStream,
      getChatHistory: () => [],
      getCurrentModel: () => 'mock-model',
      setModel: vi.fn(),
      setRecoverySessionId: vi.fn(),
      abortCurrentOperation: record.abortCurrentOperation,
      executeToolByName: vi.fn(),
      systemPromptReady: Promise.resolve(),
    };
  }),
  listServerModels: vi.fn(() => []),
  runAgentCompletion: vi.fn(),
  streamAgentDeltas: vi.fn(async function* (
    agent: {
      processUserMessageStream(
        input: string,
        options?: { surface?: string },
      ): AsyncIterable<{ type: string; content?: string }>;
    },
    input: string,
    options?: { surface?: string },
  ) {
    for await (const chunk of agent.processUserMessageStream(input, {
      surface: options?.surface,
    })) {
      if (chunk.type === 'content' && chunk.content) yield chunk.content;
    }
  }),
}));

import { DEFAULT_SERVER_CONFIG } from '../../src/server/types.js';
import {
  closeAllConnections,
  setupWebSocket,
} from '../../src/server/websocket/handler.js';
import {
  closeDesktopWebSocket,
  setupDesktopWebSocket,
} from '../../src/server/websocket/desktop-handler.js';

type ReceivedEvent = {
  type: string;
  payload?: Record<string, unknown>;
};

async function waitUntil(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for WebSocket condition');
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

async function connect(url: string): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function collectEvents(ws: WebSocket): ReceivedEvent[] {
  const events: ReceivedEvent[] = [];
  ws.on('message', (data) => {
    events.push(JSON.parse(data.toString()) as ReceivedEvent);
  });
  return events;
}

describe('WebSocket turn cancellation', () => {
  let server: HttpServer;
  let gatewayWss: WebSocketServer;
  let desktopWss: WebSocketServer;
  let wsBase: string;

  beforeEach(async () => {
    agentMockState.records.length = 0;
    server = createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    const config = {
      ...DEFAULT_SERVER_CONFIG,
      port: 0,
      host: '127.0.0.1',
      authEnabled: false,
      websocketEnabled: true,
      cors: false,
      corsOrigins: '*',
      logging: false,
    };
    gatewayWss = await setupWebSocket(server, config);
    desktopWss = await setupDesktopWebSocket(server, config);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    wsBase = `ws://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const client of desktopWss.clients) client.terminate();
    for (const client of gatewayWss.clients) client.terminate();
    closeDesktopWebSocket();
    closeAllConnections();
    await new Promise<void>((resolve) => gatewayWss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function latestAgent(): MockAgentRecord {
    const record = agentMockState.records.at(-1);
    if (!record) throw new Error('expected a mock agent');
    return record;
  }

  it('/ws stop aborts a blocked stream without a late chunk or stream_end', async () => {
    const ws = await connect(`${wsBase}/ws`);
    const events = collectEvents(ws);

    ws.send(JSON.stringify({ type: 'chat', payload: { message: 'hello', stream: true } }));
    await waitUntil(() => events.some((event) => event.type === 'stream_chunk'));
    const agent = latestAgent();

    ws.send(JSON.stringify({ type: 'stop' }));
    await waitUntil(
      () => agent.abortCurrentOperation.mock.calls.length === 1 && agent.finalized,
    );
    await waitUntil(() => events.some((event) => event.type === 'stream_stopped'));

    expect(events.filter((event) => event.type === 'stream_chunk')).toHaveLength(1);
    expect(events.some((event) => event.type === 'stream_end')).toBe(false);
    ws.close();
  });

  it('/ws stop aborts a blocked non-streaming turn and releases its lane', async () => {
    const ws = await connect(`${wsBase}/ws`);
    const events = collectEvents(ws);

    ws.send(JSON.stringify({ type: 'chat', payload: { message: 'hello', stream: false } }));
    await waitUntil(() => {
      const agent = agentMockState.records[0];
      return agentMockState.records.length === 1 && typeof agent?.release === 'function';
    });
    const agent = latestAgent();

    ws.send(JSON.stringify({ type: 'stop' }));
    // Ping uses the normal per-connection lane. Receiving pong proves the
    // aborted non-streaming chat released that lane instead of staying blocked.
    ws.send(JSON.stringify({ type: 'ping' }));
    await waitUntil(
      () => agent.abortCurrentOperation.mock.calls.length === 1 && agent.finalized,
    );
    await waitUntil(() => events.some((event) => event.type === 'pong'));

    expect(events.some((event) => event.type === 'stream_stopped')).toBe(true);
    expect(events.some((event) => event.type === 'chat_response')).toBe(false);
    expect(events.some(
      (event) => event.type === 'error'
        && (event as ReceivedEvent & { error?: { code?: string } }).error?.code === 'CHAT_ERROR',
    )).toBe(false);
    ws.close();
  });

  it('/ws close aborts and finalizes a blocked stream', async () => {
    const ws = await connect(`${wsBase}/ws`);
    const events = collectEvents(ws);
    ws.send(JSON.stringify({ type: 'chat', payload: { message: 'hello', stream: true } }));
    await waitUntil(() => events.some((event) => event.type === 'stream_chunk'));
    const agent = latestAgent();

    ws.terminate();
    await waitUntil(
      () => agent.abortCurrentOperation.mock.calls.length === 1 && agent.finalized,
    );

    expect(agent.abortCurrentOperation).toHaveBeenCalledTimes(1);
  });

  it('/ws error aborts without emitting a partial final response', async () => {
    const ws = await connect(`${wsBase}/ws`);
    const events = collectEvents(ws);
    ws.send(JSON.stringify({ type: 'chat', payload: { message: 'hello', stream: true } }));
    await waitUntil(() => events.some((event) => event.type === 'stream_chunk'));
    const agent = latestAgent();
    const serverSocket = [...gatewayWss.clients][0];
    if (!serverSocket) throw new Error('expected a server-side /ws socket');

    serverSocket.emit('error', new Error('forced socket failure'));
    await waitUntil(
      () => agent.abortCurrentOperation.mock.calls.length === 1 && agent.finalized,
    );

    expect(events.filter((event) => event.type === 'stream_chunk')).toHaveLength(1);
    expect(events.some((event) => event.type === 'stream_end')).toBe(false);
    ws.close();
  });

  it('desktop session.stop aborts without stream.message or stream.done', async () => {
    const ws = await connect(`${wsBase}/desktop`);
    const events = collectEvents(ws);
    ws.send(JSON.stringify({ type: 'session.start', payload: { prompt: 'hello' } }));
    await waitUntil(() => events.some((event) => event.type === 'stream.partial'));
    const sessionUpdate = events.find((event) => event.type === 'session.update');
    const sessionId = sessionUpdate?.payload?.sessionId;
    if (typeof sessionId !== 'string') throw new Error('expected a desktop session id');
    const agent = latestAgent();

    ws.send(JSON.stringify({ type: 'session.stop', payload: { sessionId } }));
    await waitUntil(
      () => agent.abortCurrentOperation.mock.calls.length === 1 && agent.finalized,
    );
    await waitUntil(() => events.some(
      (event) => event.type === 'session.status' && event.payload?.status === 'idle',
    ));

    expect(events.filter((event) => event.type === 'stream.partial')).toHaveLength(1);
    expect(events.some((event) => event.type === 'stream.message')).toBe(false);
    expect(events.some((event) => event.type === 'stream.done')).toBe(false);
    ws.close();
  });

  it('desktop rejects concurrent continues and stop cancels the only active provider', async () => {
    const ws = await connect(`${wsBase}/desktop`);
    const events = collectEvents(ws);
    ws.send(JSON.stringify({ type: 'session.start', payload: { prompt: 'first' } }));
    await waitUntil(() => events.some((event) => event.type === 'stream.partial'));
    const sessionUpdate = events.find((event) => event.type === 'session.update');
    const sessionId = sessionUpdate?.payload?.sessionId;
    if (typeof sessionId !== 'string') throw new Error('expected a desktop session id');
    const agent = latestAgent();

    ws.send(JSON.stringify({
      type: 'session.continue',
      payload: { sessionId, prompt: 'second' },
    }));
    ws.send(JSON.stringify({
      type: 'session.continue',
      payload: { sessionId, prompt: 'third' },
    }));
    await waitUntil(
      () => events.filter(
        (event) => event.type === 'error'
          && typeof event.payload?.message === 'string'
          && event.payload.message.includes('session is busy'),
      ).length === 2,
    );

    // Both concurrent continues are rejected before createServerAgent or the
    // provider stream can be entered for a second time.
    expect(agentMockState.records).toHaveLength(1);

    ws.send(JSON.stringify({ type: 'session.stop', payload: { sessionId } }));
    await waitUntil(
      () => agent.abortCurrentOperation.mock.calls.length === 1 && agent.finalized,
    );

    expect(events.filter((event) => event.type === 'stream.partial')).toHaveLength(1);
    expect(events.some((event) => event.type === 'stream.message')).toBe(false);
    expect(events.some((event) => event.type === 'stream.done')).toBe(false);
    ws.close();
  });

  it('desktop close aborts and finalizes every active runtime', async () => {
    const ws = await connect(`${wsBase}/desktop`);
    const events = collectEvents(ws);
    ws.send(JSON.stringify({ type: 'session.start', payload: { prompt: 'first' } }));
    ws.send(JSON.stringify({ type: 'session.start', payload: { prompt: 'second' } }));
    await waitUntil(
      () => events.filter((event) => event.type === 'stream.partial').length === 2,
    );
    expect(agentMockState.records).toHaveLength(2);

    ws.terminate();
    await waitUntil(
      () => agentMockState.records.every(
        (agent) => agent.abortCurrentOperation.mock.calls.length === 1 && agent.finalized,
      ),
    );

    for (const agent of agentMockState.records) {
      expect(agent.abortCurrentOperation).toHaveBeenCalledTimes(1);
    }
  });

  it('desktop error aborts every runtime without a partial final assistant message', async () => {
    const ws = await connect(`${wsBase}/desktop`);
    const events = collectEvents(ws);
    ws.send(JSON.stringify({ type: 'session.start', payload: { prompt: 'first' } }));
    ws.send(JSON.stringify({ type: 'session.start', payload: { prompt: 'second' } }));
    await waitUntil(
      () => events.filter((event) => event.type === 'stream.partial').length === 2,
    );
    expect(agentMockState.records).toHaveLength(2);
    const serverSocket = [...desktopWss.clients][0];
    if (!serverSocket) throw new Error('expected a server-side desktop socket');

    serverSocket.emit('error', new Error('forced socket failure'));
    await waitUntil(
      () => agentMockState.records.every(
        (agent) => agent.abortCurrentOperation.mock.calls.length === 1 && agent.finalized,
      ),
    );

    expect(events.filter((event) => event.type === 'stream.partial')).toHaveLength(2);
    expect(events.some((event) => event.type === 'stream.message')).toBe(false);
    expect(events.some((event) => event.type === 'stream.done')).toBe(false);
    ws.close();
  });
});
