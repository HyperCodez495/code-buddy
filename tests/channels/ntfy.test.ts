import http from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';

import { NtfyAdapter, NtfyChannel } from '../../src/channels/ntfy/index.js';

interface CapturedRequest {
  body: string;
  headers: http.IncomingHttpHeaders;
  method: string;
  url: string;
}

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => closeServer(server)));
  servers.length = 0;
});

describe('NtfyChannel real HTTP publishing', () => {
  it('publishes to a local ntfy-compatible HTTP endpoint preserving base paths and headers', async () => {
    const requests: CapturedRequest[] = [];
    const server = await startLocalNtfyServer(requests);
    const serverUrl = `${localServerUrl(server)}/tenant/api`;
    const channel = new NtfyChannel({
      type: 'ntfy',
      enabled: true,
      token: 'test-token',
      serverUrl,
      title: 'Code Buddy',
      priority: 'high',
      tags: ['codebuddy', 'real-test'],
    });

    await channel.connect();
    expect(JSON.stringify(channel.getStatus().info)).not.toContain('test-token');
    expect(JSON.stringify(channel.getStatus().info)).not.toContain('alerts');
    const result = await channel.send({
      channelId: 'alerts',
      content: 'Hermes ntfy smoke from Code Buddy',
      contentType: 'text',
    });

    expect(result.success, result.error).toBe(true);
    expect(result.messageId).toBe('ntfy-local-1');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/tenant/api/alerts',
      body: 'Hermes ntfy smoke from Code Buddy',
    });
    expect(requests[0]?.headers.authorization).toBe('Bearer test-token');
    expect(requests[0]?.headers.title).toBe('Code Buddy');
    expect(requests[0]?.headers.priority).toBe('high');
    expect(requests[0]?.headers.tags).toBe('codebuddy,real-test');

    await channel.disconnect();
    expect(channel.getStatus().connected).toBe(false);
  });

  it('supports official POST topic publishing through the adapter with per-message metadata', async () => {
    const requests: CapturedRequest[] = [];
    const server = await startLocalNtfyServer(requests);
    const adapter = new NtfyAdapter({
      serverUrl: localServerUrl(server),
      token: 'Bearer custom-token',
    });

    await adapter.start();
    const result = await adapter.publish('ops/status', 'Build complete', {
      title: 'Done',
      priority: 3,
      tags: 'build,green',
      sequenceId: 'run-42',
    });

    expect(result).toEqual({
      success: true,
      messageId: 'ntfy-local-1',
      status: 200,
      topic: 'ops/status',
    });
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/ops/status/run-42',
      body: 'Build complete',
    });
    expect(requests[0]?.headers.authorization).toBe('Bearer custom-token');
    expect(requests[0]?.headers.title).toBe('Done');
    expect(requests[0]?.headers.priority).toBe('3');
    expect(requests[0]?.headers.tags).toBe('build,green');

    await adapter.stop();
  });
});

async function startLocalNtfyServer(requests: CapturedRequest[]): Promise<http.Server> {
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({
        body,
        headers: request.headers,
        method: request.method ?? '',
        url: request.url ?? '',
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        event: 'message',
        id: `ntfy-local-${requests.length}`,
        message: body,
        topic: (request.url ?? '/').split('/').filter(Boolean).at(-1) ?? 'alerts',
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
