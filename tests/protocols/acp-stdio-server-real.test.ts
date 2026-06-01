import { PassThrough } from 'stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AcpStdioServer,
  ACP_PROTOCOL_VERSION,
  type AcpPromptRunner,
} from '../../src/protocols/acp/acp-stdio-server.js';

/** Drives a real AcpStdioServer over in-memory ndjson streams. */
class AcpHarness {
  readonly input = new PassThrough();
  readonly output = new PassThrough();
  readonly messages: Array<Record<string, any>> = [];
  readonly server: AcpStdioServer;

  constructor(promptRunner: AcpPromptRunner) {
    this.output.setEncoding('utf8');
    this.output.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) this.messages.push(JSON.parse(trimmed));
      }
    });
    this.server = new AcpStdioServer({ input: this.input, output: this.output, promptRunner });
    this.server.start();
  }

  send(message: Record<string, unknown>): void {
    this.input.write(`${JSON.stringify(message)}\n`);
  }

  /** Let queued async dispatch flush. */
  async flush(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 15));
  }

  responseFor(id: number): Record<string, any> | undefined {
    return this.messages.find((m) => m.id === id);
  }

  notifications(method: string): Array<Record<string, any>> {
    return this.messages.filter((m) => m.method === method && m.id === undefined);
  }
}

describe('AcpStdioServer (real ndjson transport)', () => {
  let harness: AcpHarness;

  afterEach(() => {
    harness?.server.stop();
  });

  it('negotiates capabilities on initialize', async () => {
    harness = new AcpHarness(async () => ({ stopReason: 'end_turn' }));
    harness.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } });
    await harness.flush();

    const res = harness.responseFor(1);
    expect(res?.jsonrpc).toBe('2.0');
    expect(res?.result.protocolVersion).toBe(ACP_PROTOCOL_VERSION);
    expect(res?.result.agentInfo.name).toBe('Code Buddy');
    expect(res?.result.authMethods).toEqual([]);
    expect(res?.result.agentCapabilities.promptCapabilities).toBeTruthy();
  });

  it('creates a session and runs a prompt, streaming an agent_message_chunk then end_turn', async () => {
    const runner: AcpPromptRunner = async ({ prompt, sendUpdate }) => {
      const text = prompt[0]?.text ?? '';
      sendUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `echo: ${text}` } });
      return { stopReason: 'end_turn' };
    };
    harness = new AcpHarness(runner);

    harness.send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/tmp/x', mcpServers: [] } });
    await harness.flush();
    const sessionId = harness.responseFor(1)?.result.sessionId as string;
    expect(typeof sessionId).toBe('string');

    harness.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'hello' }] },
    });
    await harness.flush();

    const updates = harness.notifications('session/update');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.params.sessionId).toBe(sessionId);
    expect(updates[0]?.params.update).toEqual({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'echo: hello' },
    });

    expect(harness.responseFor(2)?.result).toEqual({ stopReason: 'end_turn' });
  });

  it('returns a JSON-RPC error for an unknown sessionId', async () => {
    harness = new AcpHarness(async () => ({ stopReason: 'end_turn' }));
    harness.send({ jsonrpc: '2.0', id: 7, method: 'session/prompt', params: { sessionId: 'nope', prompt: [] } });
    await harness.flush();

    const res = harness.responseFor(7);
    expect(res?.error?.code).toBe(-32602);
    expect(res?.result).toBeUndefined();
  });

  it('cancels an in-flight turn via the session/cancel notification', async () => {
    const runner: AcpPromptRunner = ({ signal }) =>
      new Promise((resolve) => {
        if (signal.aborted) return resolve({ stopReason: 'cancelled' });
        signal.addEventListener('abort', () => resolve({ stopReason: 'end_turn' }));
      });
    harness = new AcpHarness(runner);

    harness.send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: {} });
    await harness.flush();
    const sessionId = harness.responseFor(1)?.result.sessionId as string;

    harness.send({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId, prompt: [{ type: 'text', text: 'long' }] } });
    await harness.flush(); // prompt is pending on the abort signal
    expect(harness.responseFor(2)).toBeUndefined();

    harness.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } }); // notification, no id
    await harness.flush();

    // Server overrides the runner's reason to 'cancelled' because the signal aborted.
    expect(harness.responseFor(2)?.result).toEqual({ stopReason: 'cancelled' });
  });

  it('reports a parse error for malformed input', async () => {
    harness = new AcpHarness(async () => ({ stopReason: 'end_turn' }));
    harness.input.write('not json\n');
    await harness.flush();

    const parseError = harness.messages.find((m) => m.error?.code === -32700);
    expect(parseError).toBeTruthy();
    expect(parseError?.id).toBeNull();
  });

  it('returns method-not-found for unknown methods', async () => {
    harness = new AcpHarness(async () => ({ stopReason: 'end_turn' }));
    harness.send({ jsonrpc: '2.0', id: 9, method: 'does/not-exist', params: {} });
    await harness.flush();

    expect(harness.responseFor(9)?.error?.code).toBe(-32601);
  });
});
