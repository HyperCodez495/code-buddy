/**
 * Nextcloud Talk real-transport proof.
 *
 * Stands up a loopback `http.createServer` on an ephemeral port that speaks the
 * Spreed chat REST API: the long-poll `GET .../chat/<roomToken>?lookIntoFuture=1`
 * returns 200 with a message (and `X-Chat-Last-Given: 42`) on the first poll,
 * then holds and 304s on subsequent polls. The `NextcloudTalkChannel` is pointed
 * at `http://127.0.0.1:<port>` so the genuine `fetch`-based long-poll + reconnect
 * paths execute — no live Nextcloud server or account is involved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { NextcloudTalkChannel } from '../../src/channels/nextcloud-talk/index.js';
import type { InboundMessage } from '../../src/channels/core.js';
import { ReconnectionManager } from '../../src/channels/reconnection-manager.js';

const ROOM = 'abc123room';

interface MockServer {
  port: number;
  server: http.Server;
  /** Number of long-poll GET requests received. */
  pollCount: () => number;
}

interface MockServerOptions {
  /**
   * If set, after this many GET polls the server destroys the socket to
   * simulate a network drop (triggers the reconnect path).
   */
  dropAfterPolls?: number;
}

async function startMockServer(opts: MockServerOptions = {}): Promise<MockServer> {
  let polls = 0;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    // Long-poll receive endpoint: GET .../chat/<roomToken>
    if (req.method === 'GET' && url.pathname.endsWith(`/chat/${ROOM}`)) {
      polls += 1;
      const thisPoll = polls;

      if (opts.dropAfterPolls && thisPoll > opts.dropAfterPolls) {
        // Simulate a hard network drop mid-poll.
        req.destroy(new Error('mock server forced drop'));
        return;
      }

      if (thisPoll === 1) {
        // First poll: deliver one message with the last-given cursor header.
        const body = JSON.stringify({
          ocs: {
            meta: { status: 'ok', statuscode: 200, message: 'OK' },
            data: [
              {
                id: 42,
                token: ROOM,
                actorId: 'alice',
                actorDisplayName: 'Alice',
                actorType: 'users',
                message: 'hello-nct',
                timestamp: Math.floor(Date.now() / 1000),
              },
            ],
          },
        });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'X-Chat-Last-Given': '42',
        });
        res.end(body);
        return;
      }

      // Subsequent polls: hold briefly then 304 (long-poll timeout, no msgs).
      setTimeout(() => {
        if (!res.writableEnded) {
          res.writeHead(304);
          res.end();
        }
      }, 30);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;

  return { port, server, pollCount: () => polls };
}

describe('NextcloudTalkChannel real long-poll transport', () => {
  let mock: MockServer | undefined;
  let channel: NextcloudTalkChannel | undefined;

  afterEach(async () => {
    if (channel) {
      await channel.disconnect();
      channel = undefined;
    }
    if (mock) {
      await new Promise<void>((resolve) => mock!.server.close(() => resolve()));
      mock = undefined;
    }
    vi.restoreAllMocks();
  });

  it('connects on the first successful poll and emits a message with the delivered content', async () => {
    mock = await startMockServer();

    channel = new NextcloudTalkChannel({
      type: 'nextcloud-talk',
      enabled: true,
      url: `http://127.0.0.1:${mock.port}`,
      username: 'admin',
      password: 'admin-pass',
      roomToken: ROOM,
      pollTimeoutSecs: 1,
    });

    const connected = new Promise<void>((resolve) => channel!.once('connected', () => resolve()));
    const received = new Promise<InboundMessage>((resolve) =>
      channel!.once('message', (m: InboundMessage) => resolve(m)),
    );

    await channel.connect();

    // (1) connected fires only after the first successful poll.
    await connected;
    expect(channel.getStatus().connected).toBe(true);

    // (2) the delivered message surfaces as an InboundMessage.
    const msg = await received;
    expect(msg.content).toBe('hello-nct');
    expect(msg.sender.id).toBe('alice');
    expect(msg.channel.type).toBe('nextcloud-talk');
    expect(mock.pollCount()).toBeGreaterThanOrEqual(1);
  });

  it('schedules a reconnect when a poll fails (network drop)', async () => {
    mock = await startMockServer({ dropAfterPolls: 1 });

    const scheduleSpy = vi.spyOn(ReconnectionManager.prototype, 'scheduleReconnect');

    channel = new NextcloudTalkChannel({
      type: 'nextcloud-talk',
      enabled: true,
      url: `http://127.0.0.1:${mock.port}`,
      username: 'admin',
      password: 'admin-pass',
      roomToken: ROOM,
      pollTimeoutSecs: 1,
      retryDelayMs: 50,
    });

    // Absorb the surfaced 'error'/'disconnected' so the bare EventEmitter
    // doesn't throw on an unhandled 'error' during the drop.
    channel.on('error', () => {});
    channel.on('disconnected', () => {});

    await channel.connect();

    // First poll succeeds, second poll is dropped → scheduleReconnect invoked.
    await vi.waitFor(
      () => {
        expect(scheduleSpy).toHaveBeenCalled();
      },
      { timeout: 5000, interval: 25 },
    );
  });

  it('send() POSTs { message } to the Spreed chat endpoint with Basic auth + OCS header', async () => {
    // Unit-test send() against a mocked fetch — asserts the wire contract.
    // Branch on method so the GET long-poll started by connect() gets an honest
    // 304 (empty timeout) instead of the POST-shaped body, which would make the
    // receive loop iterate a non-array `data` and error in the background.
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(
          JSON.stringify({ ocs: { meta: { status: 'ok', statuscode: 201 }, data: { id: 99 } } }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // GET poll: pace the loop then return a long-poll timeout.
      await new Promise((r) => setTimeout(r, 20));
      return new Response(null, { status: 304 });
    });
    vi.stubGlobal('fetch', fetchMock);

    channel = new NextcloudTalkChannel({
      type: 'nextcloud-talk',
      enabled: true,
      url: 'https://cloud.example.com',
      username: 'admin',
      password: 'admin-pass',
      roomToken: ROOM,
    });
    // connect() so the channel has a live client; the long-poll GET also goes
    // through the mocked fetch (resolves immediately with the 201 body, which is
    // a non-304 ok response → harmless for this assertion).
    await channel.connect();

    const result = await channel.send({ channelId: ROOM, content: 'reply-text' });
    expect(result.success).toBe(true);
    expect(result.messageId).toBe('99');

    // Find the POST call (connect() may have issued GET poll calls first).
    const postCall = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCall).toBeDefined();
    const [calledUrl, init] = postCall as [string, RequestInit];
    expect(calledUrl).toBe(
      `https://cloud.example.com/ocs/v2.php/apps/spreed/api/v1/chat/${ROOM}`,
    );
    expect(JSON.parse(String(init.body))).toEqual({ message: 'reply-text' });

    const headers = init.headers as Record<string, string>;
    expect(headers['OCS-APIRequest']).toBe('true');
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from('admin:admin-pass').toString('base64')}`,
    );
    expect(headers['Content-Type']).toBe('application/json');

    vi.unstubAllGlobals();
  });
});
