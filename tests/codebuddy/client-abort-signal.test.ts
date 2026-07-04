import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { CodeBuddyClient } from '@/codebuddy/client.js';

/**
 * `CodeBuddyClient.chat` AbortSignal support (added for voice barge-in). No mocks: a REAL
 * local HTTP server stands in for an OpenAI-compatible endpoint, so we exercise the true
 * transport (undici fetch) honoring `ChatOptions.signal`.
 *
 * - Without a signal: behavior is unchanged (a request resolves to the response content).
 * - With an aborted signal: the in-flight request is cancelled and `chat()` rejects.
 */

const COMPLETION = {
  id: 'cmpl-test',
  object: 'chat.completion',
  created: 0,
  model: 'llama3.2',
  choices: [
    { index: 0, message: { role: 'assistant', content: 'bonjour patrice' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

describe('CodeBuddyClient.chat — AbortSignal support (real transport)', () => {
  let server: Server;
  let baseURL: string;
  /** When >0, the server delays its response by this many ms (to be aborted mid-flight). */
  let responseDelayMs = 0;

  beforeAll(async () => {
    server = createServer((_req: IncomingMessage, res: ServerResponse) => {
      const send = (): void => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(COMPLETION));
      };
      if (responseDelayMs > 0) {
        const timer = setTimeout(send, responseDelayMs);
        res.on('close', () => clearTimeout(timer));
      } else {
        send();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    baseURL = `http://127.0.0.1:${port}/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function client(): CodeBuddyClient {
    // enableFallbacks:false → no cross-provider fallback noise, the primary error surfaces directly.
    return new CodeBuddyClient('test-key', 'llama3.2', baseURL, { enableFallbacks: false });
  }

  it('without a signal, a request resolves normally (unchanged behavior)', async () => {
    responseDelayMs = 0;
    const resp = await client().chat([{ role: 'user', content: 'salut' }], []);
    expect(resp.choices[0]?.message?.content).toBe('bonjour patrice');
  });

  it('an already-aborted signal makes chat() reject without a completed request', async () => {
    responseDelayMs = 0;
    const signal = AbortSignal.abort();
    await expect(
      client().chat([{ role: 'user', content: 'salut' }], [], { signal }),
    ).rejects.toBeDefined();
  });

  it('aborting mid-flight cancels the in-flight request and rejects', async () => {
    responseDelayMs = 5000; // server would answer in 5s; we abort well before.
    const controller = new AbortController();
    const p = client().chat([{ role: 'user', content: 'salut' }], [], { signal: controller.signal });
    // Give the request time to leave, then barge-in.
    setTimeout(() => controller.abort(), 50);
    await expect(p).rejects.toBeDefined();
  });
});
