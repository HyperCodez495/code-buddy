import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

// Controllable fake `ws` so we can drive Socket Mode open/close events. Defined
// inside vi.hoisted so it exists before vi.mock('ws') runs.
const { FakeWebSocket, wsState } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { EventEmitter } = require('node:events') as typeof import('node:events');
  const state: { instances: Array<InstanceType<typeof FW>> } = { instances: [] };
  class FW extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    url: string;
    send = vi.fn();
    ping = vi.fn();
    close = vi.fn(() => {
      (this as FW).readyState = 3;
    });
    constructor(url: string) {
      super();
      this.url = url;
      state.instances.push(this);
    }
  }
  return { FakeWebSocket: FW, wsState: state };
});
vi.mock('ws', () => ({ default: FakeWebSocket }));

import { SlackChannel } from '../src/main/remote/channels/slack/slack-channel';
import type { RemoteMessage, SlackChannelConfig } from '../src/main/remote/types';

const SIGNING_SECRET = 'test-signing-secret';

function makeConfig(overrides: Partial<SlackChannelConfig> = {}): SlackChannelConfig {
  return {
    type: 'slack',
    botToken: 'xoxb-test',
    signingSecret: SIGNING_SECRET,
    dm: { policy: 'open' },
    ...overrides,
  };
}

/** Build a valid Slack v0 signature for the given body + timestamp. */
function sign(body: string, timestamp: string): string {
  return (
    'v0=' +
    crypto.createHmac('sha256', SIGNING_SECRET).update(`v0:${timestamp}:${body}`).digest('hex')
  );
}

/** Mock auth.test (start) and capture chat.postMessage calls. */
function mockSlackFetch() {
  const posts: Array<{ method: string; body: Record<string, unknown> }> = [];
  const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
    const method = String(url).split('/api/')[1] || '';
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    posts.push({ method, body });
    if (method === 'auth.test') {
      return { json: async () => ({ ok: true, user_id: 'UBOT', user: 'mybot', team: 'T1' }) };
    }
    if (method === 'apps.connections.open') {
      return { json: async () => ({ ok: true, url: 'wss://fake.slack/socket' }) };
    }
    if (method === 'chat.postMessage') {
      return { json: async () => ({ ok: true, ts: '111.222' }) };
    }
    return { json: async () => ({ ok: true }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { posts };
}

describe('SlackChannel', () => {
  beforeEach(() => {
    mockSlackFetch();
    wsState.instances.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('answers the url_verification challenge without requiring a signature', async () => {
    const channel = new SlackChannel(makeConfig());
    const body = JSON.stringify({ type: 'url_verification', challenge: 'abc123' });
    const result = await channel.handleWebhook({}, body);
    expect(result.status).toBe(200);
    expect(result.data.challenge).toBe('abc123');
  });

  it('rejects an event_callback with an invalid signature', async () => {
    const channel = new SlackChannel(makeConfig());
    const body = JSON.stringify({ type: 'event_callback', event: { type: 'message' } });
    const ts = String(Math.floor(Date.now() / 1000));
    const result = await channel.handleWebhook(
      { 'x-slack-signature': 'v0=deadbeef', 'x-slack-request-timestamp': ts },
      body
    );
    expect(result.status).toBe(403);
  });

  it('parses a signed group message event into a RemoteMessage and strips the bot mention', async () => {
    const channel = new SlackChannel(makeConfig());
    await channel.start(); // captures botUserId via auth.test

    const received: RemoteMessage[] = [];
    channel.onMessage((m) => received.push(m));

    const event = {
      type: 'message',
      user: 'U123',
      channel: 'C999',
      channel_type: 'channel',
      text: '<@UBOT> hello there',
      ts: '1700000000.000100',
    };
    const body = JSON.stringify({ type: 'event_callback', event });
    const ts = String(Math.floor(Date.now() / 1000));
    const result = await channel.handleWebhook(
      { 'x-slack-signature': sign(body, ts), 'x-slack-request-timestamp': ts },
      body
    );

    expect(result.status).toBe(200);
    expect(received).toHaveLength(1);
    const msg = received[0]!;
    expect(msg.channelType).toBe('slack');
    expect(msg.channelId).toBe('C999');
    expect(msg.sender.id).toBe('U123');
    expect(msg.content.text).toBe('hello there'); // <@UBOT> stripped
    expect(msg.isGroup).toBe(true);
    expect(msg.isMentioned).toBe(true);
  });

  it('ignores the bot\'s own messages', async () => {
    const channel = new SlackChannel(makeConfig());
    await channel.start();
    const received: RemoteMessage[] = [];
    channel.onMessage((m) => received.push(m));

    const event = { type: 'message', user: 'UBOT', channel: 'C1', text: 'echo', ts: '1.0' };
    const body = JSON.stringify({ type: 'event_callback', event });
    const ts = String(Math.floor(Date.now() / 1000));
    await channel.handleWebhook(
      { 'x-slack-signature': sign(body, ts), 'x-slack-request-timestamp': ts },
      body
    );
    expect(received).toHaveLength(0);
  });

  it('sends a response via chat.postMessage with channel + text', async () => {
    const { posts } = mockSlackFetch();
    const channel = new SlackChannel(makeConfig());
    await channel.start();

    await channel.send({
      channelType: 'slack',
      channelId: 'C42',
      content: { type: 'text', text: 'hi from agent' },
    });

    const post = posts.find((p) => p.method === 'chat.postMessage');
    expect(post).toBeDefined();
    expect(post!.body.channel).toBe('C42');
    expect(post!.body.text).toBe('hi from agent');
  });

  it('converts standard Markdown replies to Slack mrkdwn', async () => {
    const { posts } = mockSlackFetch();
    const channel = new SlackChannel(makeConfig());
    await channel.start();

    await channel.send({
      channelType: 'slack',
      channelId: 'C1',
      content: { type: 'markdown', markdown: '# Title\n**bold** and [link](https://x.com)' },
    });

    const post = posts.find((p) => p.method === 'chat.postMessage');
    const text = String(post!.body.text);
    expect(text).toContain('*Title*'); // header -> bold
    expect(text).toContain('*bold*'); // **bold** -> *bold*
    expect(text).toContain('<https://x.com|link>'); // markdown link -> slack link
    expect(text).not.toContain('**');
  });

  it('restores connected state after a Socket Mode reconnect (send must still work)', async () => {
    vi.useFakeTimers();
    try {
      const channel = new SlackChannel(makeConfig({ appToken: 'xapp-x', useSocketMode: true }));
      const startPromise = channel.start();
      // Flush auth.test + apps.connections.open before the socket is constructed.
      await vi.advanceTimersByTimeAsync(0);
      expect(wsState.instances).toHaveLength(1);
      wsState.instances[0]!.emit('open');
      await startPromise;

      // Drop the socket; the reconnect timer should fire and open a new socket.
      wsState.instances[0]!.emit('close');
      await vi.advanceTimersByTimeAsync(1100); // attempt 0 backoff = 1000ms
      expect(wsState.instances.length).toBe(2);
      wsState.instances[1]!.emit('open');
      await vi.advanceTimersByTimeAsync(0);

      // The bug: _connected was only set in start(), so send() threw after reconnect.
      await expect(
        channel.send({ channelType: 'slack', channelId: 'C1', content: { type: 'text', text: 'after reconnect' } })
      ).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
