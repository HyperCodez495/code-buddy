import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { executeDiscordTool } from '../../src/tools/discord-platform-tool.js';
import { executeHomeAssistantTool } from '../../src/tools/homeassistant-tool.js';
import { executeSpotifyTool } from '../../src/tools/spotify-tool.js';
import { executeXSearch } from '../../src/tools/x-search-tool.js';

interface CapturedRequest {
  authorization?: string;
  method: string;
  path: string;
}

let server: Server;
let rootUrl: string;
let requests: CapturedRequest[];

describe('tool request URLs preserve configured base path segments', () => {
  beforeEach(async () => {
    requests = [];
    server = createServer(handleRequest);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    rootUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('keeps /v1 on the xAI Responses endpoint over real HTTP', async () => {
    const result = await executeXSearch(
      { query: 'hi' },
      { apiKey: 'xai-test-token', baseUrl: `${rootUrl}/v1`, retries: 0 },
    );

    expect(result.success, result.error).toBe(true);
    expect(requests).toContainEqual(expect.objectContaining({
      authorization: 'Bearer xai-test-token',
      method: 'POST',
      path: '/v1/responses',
    }));
  });

  it('keeps /v1 on the Spotify Web API over real HTTP', async () => {
    const result = await executeSpotifyTool(
      'spotify_devices',
      { action: 'list' },
      { accessToken: 'spotify-test-token', apiBaseUrl: `${rootUrl}/v1` },
    );

    expect(result.ok, result.error).toBe(true);
    expect(requests).toContainEqual(expect.objectContaining({
      authorization: 'Bearer spotify-test-token',
      method: 'GET',
      path: '/v1/me/player/devices',
    }));
  });

  it('keeps /api/v10 on Discord API routes over real HTTP', async () => {
    const result = await executeDiscordTool(
      { action: 'fetch_messages', channel_id: '123' },
      { token: 'discord-test-token', apiBaseUrl: `${rootUrl}/api/v10` },
    );

    expect(result.ok, result.error).toBe(true);
    expect(requests).toContainEqual(expect.objectContaining({
      authorization: 'Bot discord-test-token',
      method: 'GET',
      path: '/api/v10/channels/123/messages?limit=50',
    }));
  });

  it('keeps a reverse-proxy path on Home Assistant API routes over real HTTP', async () => {
    const result = await executeHomeAssistantTool(
      'ha_list_entities',
      {},
      { token: 'hass-test-token', url: `${rootUrl}/ha` },
    );

    expect(result.ok, result.error).toBe(true);
    expect(requests).toContainEqual(expect.objectContaining({
      authorization: 'Bearer hass-test-token',
      method: 'GET',
      path: '/ha/api/states',
    }));
  });
});

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await readBody(req);
  const path = req.url ?? '/';
  requests.push({
    authorization: req.headers.authorization,
    method: req.method ?? 'GET',
    path,
  });

  if (req.method === 'POST' && path === '/v1/responses') {
    writeJson(res, 200, { output_text: 'x_search response with preserved base path.' });
    return;
  }
  if (req.method === 'GET' && path === '/v1/me/player/devices') {
    writeJson(res, 200, { devices: [] });
    return;
  }
  if (req.method === 'GET' && path === '/api/v10/channels/123/messages?limit=50') {
    writeJson(res, 200, []);
    return;
  }
  if (req.method === 'GET' && path === '/ha/api/states') {
    writeJson(res, 200, []);
    return;
  }

  writeJson(res, 404, { message: `unexpected test route: ${req.method} ${path}` });
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
