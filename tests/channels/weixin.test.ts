import http from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';

import { WeixinAdapter, WeixinChannel } from '../../src/channels/weixin/index.js';

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

describe('WeixinChannel real HTTP customer-service publishing', () => {
  it('posts text customer-service messages to a local Weixin-compatible endpoint without exposing tokens', async () => {
    const requests: CapturedRequest[] = [];
    const server = await startLocalWeixinServer(requests);
    const channel = new WeixinChannel({
      type: 'weixin',
      enabled: true,
      accessToken: 'weixin-access-token-123',
      apiBaseUrl: `${localServerUrl(server)}/tenant`,
      kfAccount: 'agent@example',
    });

    await channel.connect();
    expect(JSON.stringify(channel.getStatus().info)).not.toContain('weixin-access-token-123');
    expect(JSON.stringify(channel.getStatus().info)).not.toContain('agent@example');

    const result = await channel.send({
      channelId: 'openid-123',
      content: 'Hermes Weixin smoke from Code Buddy',
      contentType: 'text',
    });

    expect(result.success, result.error).toBe(true);
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]!.url, localServerUrl(server));
    expect(requests[0]).toMatchObject({
      method: 'POST',
    });
    expect(url.pathname).toBe('/tenant/cgi-bin/message/custom/send');
    expect(url.searchParams.get('access_token')).toBe('weixin-access-token-123');
    expect(requests[0]?.headers['content-type']).toContain('application/json');
    expect(requests[0]?.body).toEqual({
      customservice: {
        kf_account: 'agent@example',
      },
      msgtype: 'text',
      text: {
        content: 'Hermes Weixin smoke from Code Buddy',
      },
      touser: 'openid-123',
    });

    await channel.disconnect();
    expect(channel.getStatus().connected).toBe(false);
  });

  it('supports explicit webhook URLs through the adapter', async () => {
    const requests: CapturedRequest[] = [];
    const server = await startLocalWeixinServer(requests);
    const adapter = new WeixinAdapter({
      webhookUrl: `${localServerUrl(server)}/cgi-bin/message/custom/send?access_token=abc`,
    });

    await adapter.start();
    const result = await adapter.sendText('openid-456', 'Build complete');

    expect(result).toEqual({
      errcode: 0,
      errmsg: 'ok',
      success: true,
      status: 200,
    });
    expect(requests[0]?.body).toEqual({
      msgtype: 'text',
      text: {
        content: 'Build complete',
      },
      touser: 'openid-456',
    });

    await adapter.stop();
  });
});

async function startLocalWeixinServer(requests: CapturedRequest[]): Promise<http.Server> {
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
      response.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }));
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
