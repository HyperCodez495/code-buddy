import { createHmac } from 'crypto';
import http from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';

import { DingTalkAdapter, DingTalkChannel } from '../../src/channels/dingtalk/index.js';

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

describe('DingTalkChannel real HTTP webhook publishing', () => {
  it('posts text messages to a local DingTalk-compatible webhook with HMAC signing', async () => {
    const requests: CapturedRequest[] = [];
    const server = await startLocalDingTalkServer(requests);
    const webhookUrl = `${localServerUrl(server)}/robot/send?access_token=access-token-123`;
    const secret = 'SEC-test-secret';
    const now = 1760000000000;
    const channel = new DingTalkChannel({
      type: 'dingtalk',
      enabled: true,
      webhookUrl,
      secret,
      atMobiles: ['15555550123'],
    }, { now: () => now });

    await channel.connect();
    expect(JSON.stringify(channel.getStatus().info)).not.toContain('access-token-123');
    expect(JSON.stringify(channel.getStatus().info)).not.toContain(secret);

    const result = await channel.send({
      channelId: 'robot',
      content: 'Hermes DingTalk smoke from Code Buddy',
      contentType: 'text',
    });

    expect(result.success, result.error).toBe(true);
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]!.url, localServerUrl(server));
    expect(requests[0]).toMatchObject({
      method: 'POST',
    });
    expect(url.pathname).toBe('/robot/send');
    expect(url.searchParams.get('access_token')).toBe('access-token-123');
    expect(url.searchParams.get('timestamp')).toBe(String(now));
    expect(url.searchParams.get('sign')).toBe(
      createHmac('sha256', secret).update(`${now}\n${secret}`).digest('base64'),
    );
    expect(requests[0]?.headers['content-type']).toContain('application/json');
    expect(requests[0]?.body).toEqual({
      at: {
        atMobiles: ['15555550123'],
      },
      msgtype: 'text',
      text: {
        content: 'Hermes DingTalk smoke from Code Buddy',
      },
    });

    await channel.disconnect();
    expect(channel.getStatus().connected).toBe(false);
  });

  it('supports markdown robot messages through the adapter', async () => {
    const requests: CapturedRequest[] = [];
    const server = await startLocalDingTalkServer(requests);
    const adapter = new DingTalkAdapter({
      webhookUrl: `${localServerUrl(server)}/robot/send?access_token=abc`,
      msgType: 'markdown',
      title: 'Build report',
    });

    await adapter.start();
    const result = await adapter.send('### Build complete\nAll checks passed');

    expect(result).toEqual({
      errcode: 0,
      errmsg: 'ok',
      success: true,
      status: 200,
    });
    expect(requests[0]?.body).toEqual({
      markdown: {
        text: '### Build complete\nAll checks passed',
        title: 'Build report',
      },
      msgtype: 'markdown',
    });

    await adapter.stop();
  });
});

async function startLocalDingTalkServer(requests: CapturedRequest[]): Promise<http.Server> {
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
