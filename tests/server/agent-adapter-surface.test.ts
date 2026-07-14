import { describe, expect, it, vi } from 'vitest';

import {
  runAgentCompletion,
  streamAgentDeltas,
  type ServerAgent,
} from '../../src/server/agent-adapter.js';

function createAgent(): {
  agent: ServerAgent;
  processUserMessage: ReturnType<typeof vi.fn>;
  processUserMessageStream: ReturnType<typeof vi.fn>;
} {
  const processUserMessage = vi.fn(async () => [
    { type: 'assistant' as const, content: 'ok', timestamp: new Date() },
  ]);
  const processUserMessageStream = vi.fn(async function* () {
    yield { type: 'content' as const, content: 'streamed' };
    yield { type: 'done' as const };
  });
  const agent: ServerAgent = {
    processUserMessage,
    processUserMessageStream,
    getChatHistory: () => [],
    getCurrentModel: () => 'test-model',
    setModel: vi.fn(),
    abortCurrentOperation: vi.fn(),
    executeToolByName: vi.fn(async () => ({ success: true })),
    systemPromptReady: Promise.resolve(),
  };
  return { agent, processUserMessage, processUserMessageStream };
}

describe('server agent surface provenance', () => {
  it('marks non-streaming HTTP turns as http', async () => {
    const { agent, processUserMessage } = createAgent();

    await runAgentCompletion(agent, 'inspecte ton propre code');

    expect(processUserMessage).toHaveBeenCalledWith('inspecte ton propre code', {
      surface: 'http',
    });
  });

  it('marks streaming HTTP turns as http', async () => {
    const { agent, processUserMessageStream } = createAgent();

    const chunks: string[] = [];
    for await (const chunk of streamAgentDeltas(agent, 'comment fonctionnes-tu ?')) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['streamed']);
    expect(processUserMessageStream).toHaveBeenCalledWith('comment fonctionnes-tu ?', {
      surface: 'http',
    });
  });

  it('preserves an explicit WebSocket surface for both completion modes', async () => {
    const { agent, processUserMessage, processUserMessageStream } = createAgent();

    await runAgentCompletion(agent, 'qui es-tu ?', { surface: 'websocket' });
    for await (const _chunk of streamAgentDeltas(agent, 'tes limites ?', {
      surface: 'websocket',
    })) {
      // consume the stream
    }

    expect(processUserMessage).toHaveBeenCalledWith('qui es-tu ?', {
      surface: 'websocket',
    });
    expect(processUserMessageStream).toHaveBeenCalledWith('tes limites ?', {
      surface: 'websocket',
    });
  });
});
