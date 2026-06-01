import http from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';

import { QQAdapter, QQChannel } from '../../src/channels/qq/index.js';

interface CapturedRequest {
  body: Record<string, unknown>;
  headers: http.IncomingHttpHeaders;
  method: string;
  url: string;
}

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => closeServer(server)));
  servers.length = 0;
});

describe('QQChannel real HTTP OneBot publishing', () => {
  it('posts private messages to a local OneBot-compatible endpoint without exposing access tokens', async () => {
    const requests: CapturedRequest[] = [];
    const server = await startLocalOneBotServer(requests);
    const baseUrl = `${localServerUrl(server)}/onebot/v11?access_token=query-secret`;
    const channel = new QQChannel({
      type: 'qq',
      enabled: true,
      token: 'onebot-token-123',
      baseUrl,
    });

    await channel.connect();
    expect(JSON.stringify(channel.getStatus().info)).not.toContain('onebot-token-123');
    expect(JSON.stringify(channel.getStatus().info)).not.toContain('query-secret');

    const result = await channel.send({
      channelId: 'private:10001',
      content: 'Hermes QQ smoke from Code Buddy',
      contentType: 'text',
    });

    expect(result.success, result.error).toBe(true);
    expect(result.messageId).toBe('42');
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]!.url, localServerUrl(server));
    expect(requests[0]).toMatchObject({
      method: 'POST',
    });
    expect(url.pathname).toBe('/onebot/v11/send_private_msg');
    expect(url.searchParams.get('access_token')).toBe('query-secret');
    expect(requests[0]?.headers.authorization).toBe('Bearer onebot-token-123');
    expect(requests[0]?.body).toEqual({
      auto_escape: true,
      message: 'Hermes QQ smoke from Code Buddy',
      user_id: 10001,
    });

    await channel.disconnect();
    expect(channel.getStatus().connected).toBe(false);
  });

  it('posts group messages through the adapter with explicit message type', async () => {
    const requests: CapturedRequest[] = [];
    const server = await startLocalOneBotServer(requests);
    const adapter = new QQAdapter({
      baseUrl: localServerUrl(server),
      accessToken: 'Bearer existing-token',
      autoEscape: false,
    });

    await adapter.start();
    const result = await adapter.send('group:20002', 'Build complete', { messageType: 'group' });

    expect(result).toEqual({
      messageId: '42',
      retcode: 0,
      status: 'ok',
      success: true,
    });
    expect(requests[0]?.url).toBe('/send_group_msg');
    expect(requests[0]?.headers.authorization).toBe('Bearer existing-token');
    expect(requests[0]?.body).toEqual({
      auto_escape: false,
      group_id: 20002,
      message: 'Build complete',
    });

    await adapter.stop();
  });
});

async function startLocalOneBotServer(requests: CapturedRequest[]): Promise<http.Server> {
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({
        body: JSON.parse(body) as Record<string, unknown>,
        headers: request.headers,
        method: request.method ?? '',
        url: request.url ?? '',
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        data: { message_id: 42 },
        retcode: 0,
        status: 'ok',
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return server;
}

function localServerUrl(server: http.Server): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: http.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
