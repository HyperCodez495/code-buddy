import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildLocalHermesToolParityManifest } from '../../src/agent/hermes-tool-parity-local.js';
import { createXSearchTools } from '../../src/tools/registry/x-search-tools.js';

interface CapturedRequest {
  method: string;
  path: string;
  authorization?: string;
  userAgent?: string;
  body: Record<string, unknown>;
}

let server: Server;
let baseUrl: string;
let requests: CapturedRequest[];

describe('Hermes x_search real HTTP integration', () => {
  beforeEach(async () => {
    requests = [];
    server = createServer(handleXaiRequest);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('posts the xAI Responses x_search payload over real HTTP and extracts citations', async () => {
    const [tool] = createXSearchTools({
      apiKey: 'xai-test-token',
      baseUrl,
      model: 'grok-test-search',
      retries: 0,
      userAgent: 'Code-Buddy-Test/1.0',
    });

    const result = await tool!.execute({
      query: 'What are people saying about Code Buddy on X?',
      allowed_x_handles: ['@xai', 'grok'],
      from_date: '2026-04-01',
      to_date: '2026-04-10',
      enable_image_understanding: true,
    });

    expect(result.success, result.error).toBe(true);
    expect(JSON.parse(result.output as string)).toMatchObject({
      success: true,
      provider: 'xai',
      credential_source: 'option',
      tool: 'x_search',
      model: 'grok-test-search',
      query: 'What are people saying about Code Buddy on X?',
      answer: 'People on X are discussing Code Buddy.',
      citations: [
        {
          url: 'https://x.com/example/status/1',
          title: 'Example post',
        },
      ],
      inline_citations: [
        {
          url: 'https://x.com/xai/status/123',
          title: 'xAI update',
          start_index: 0,
          end_index: 3,
        },
      ],
      degraded: false,
      degraded_reason: null,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      path: '/responses',
      authorization: 'Bearer xai-test-token',
      userAgent: 'Code-Buddy-Test/1.0',
      body: {
        model: 'grok-test-search',
        store: false,
        input: [
          {
            role: 'user',
            content: 'What are people saying about Code Buddy on X?',
          },
        ],
        tools: [
          {
            type: 'x_search',
            allowed_x_handles: ['xai', 'grok'],
            from_date: '2026-04-01',
            to_date: '2026-04-10',
            enable_image_understanding: true,
          },
        ],
      },
    });
  });

  it('fails fast on invalid filters before any network call', async () => {
    const [tool] = createXSearchTools({ apiKey: 'xai-test-token', baseUrl });

    const conflicting = await tool!.execute({
      query: 'latest xai discussion',
      allowed_x_handles: ['xai'],
      excluded_x_handles: ['grok'],
    });
    expect(conflicting.success).toBe(false);
    expect(conflicting.error).toBe('allowed_x_handles and excluded_x_handles cannot be used together');

    const invalidDate = await tool!.execute({
      query: 'latest xai discussion',
      from_date: '2026/04/01',
    });
    expect(invalidDate.success).toBe(false);
    expect(invalidDate.error).toContain('from_date must be YYYY-MM-DD');
    expect(requests).toHaveLength(0);
  });

  it('retries transient 5xx responses and marks filtered uncited answers as degraded', async () => {
    const [tool] = createXSearchTools({
      apiKey: 'xai-test-token',
      baseUrl,
      model: 'grok-test-search',
      retries: 1,
      sleepMs: async () => {},
    });

    const result = await tool!.execute({
      query: 'transient no citation result',
      allowed_x_handles: ['xai'],
    });

    expect(result.success, result.error).toBe(true);
    expect(JSON.parse(result.output as string)).toMatchObject({
      success: true,
      answer: 'Recovered after retry without citations.',
      citations: [],
      inline_citations: [],
      degraded: true,
      degraded_reason: 'no citations returned despite filters: allowed_x_handles',
    });
    expect(requests).toHaveLength(2);
  });

  it('marks the official Hermes x_search tool as exact local parity', () => {
    const manifest = buildLocalHermesToolParityManifest('2026-05-30T22:30:00.000Z');
    expect(manifest.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'x_search',
        status: 'exact',
        detectedCodeBuddyTools: ['x_search'],
      }),
    ]));
  });
});

async function handleXaiRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const parsedBody = body ? JSON.parse(body) as Record<string, unknown> : {};
  requests.push({
    method: req.method ?? 'GET',
    path: req.url ?? '/',
    authorization: req.headers.authorization,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    body: parsedBody,
  });

  const input = JSON.stringify(parsedBody.input ?? []);
  if (input.includes('transient no citation result') && requests.length === 1) {
    writeJson(res, 500, { code: 'internal_error', error: 'Service temporarily unavailable.' });
    return;
  }
  if (input.includes('transient no citation result')) {
    writeJson(res, 200, { output_text: 'Recovered after retry without citations.' });
    return;
  }
  writeJson(res, 200, {
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: 'People on X are discussing Code Buddy.',
            annotations: [
              {
                type: 'url_citation',
                url: 'https://x.com/xai/status/123',
                title: 'xAI update',
                start_index: 0,
                end_index: 3,
              },
            ],
          },
        ],
      },
    ],
    citations: [
      {
        url: 'https://x.com/example/status/1',
        title: 'Example post',
      },
    ],
  });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}
