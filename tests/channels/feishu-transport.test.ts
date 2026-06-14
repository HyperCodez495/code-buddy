/**
 * Feishu (Lark) channel transport.
 *
 * Two halves, matching the channel's design:
 *
 * 1. **Outbound REST send() — real and verifiable.** We mock `fetch` with a
 *    sequential queue (tenant_access_token exchange, then the
 *    im/v1/messages POST) and assert the exact URLs, headers, and bodies the
 *    real Feishu Open API expects. This is the genuine outbound path — no live
 *    Feishu tenant involved.
 *
 * 2. **Inbound receive — honest "not implemented" state.** Feishu's real-time
 *    push rides a proprietary Protobuf long-connection whose framing ships only
 *    inside the official Lark SDK. We deliberately do NOT fake a socket, so the
 *    test asserts that connect() reports a structured send-only state rather
 *    than claiming a live inbound connection. (Faking a mock against our own
 *    invented framing would test nothing real.)
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FeishuChannel,
  parseFeishuMessageEvent,
  type FeishuReceiveEventBody,
} from '../../src/channels/feishu/index.js';
import type { InboundMessage } from '../../src/channels/core.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A fetch double that returns queued responses in order. */
function queuedFetch(responses: Response[]): ReturnType<typeof vi.fn> {
  const queue = [...responses];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('queuedFetch: no more responses queued');
    return next;
  });
}

function makeChannel(): FeishuChannel {
  return new FeishuChannel({
    type: 'feishu',
    enabled: true,
    appId: 'cli_app_id',
    appSecret: 'app_secret',
  });
}

describe('FeishuChannel.send() — real REST outbound', () => {
  afterEach(() => vi.restoreAllMocks());

  it('mints a tenant_access_token then POSTs a text message to im/v1/messages', async () => {
    const fetchMock = queuedFetch([
      jsonResponse({ code: 0, msg: 'ok', tenant_access_token: 'tok-123', expire: 7200 }),
      jsonResponse({ code: 0, msg: 'ok', data: { message_id: 'om_abc' } }),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const channel = makeChannel();
    await channel.connect();

    const result = await channel.send({ channelId: 'oc_chat1', content: 'hello-feishu' });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('om_abc');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // First call: the tenant_access_token exchange.
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    );
    expect(tokenInit.method).toBe('POST');
    expect(JSON.parse(tokenInit.body as string)).toEqual({
      app_id: 'cli_app_id',
      app_secret: 'app_secret',
    });

    // Second call: the actual message POST with the bearer token.
    const [msgUrl, msgInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(msgUrl).toBe(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
    );
    expect(msgInit.method).toBe('POST');
    expect((msgInit.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-123');
    const body = JSON.parse(msgInit.body as string);
    expect(body.receive_id).toBe('oc_chat1');
    expect(body.msg_type).toBe('text');
    expect(JSON.parse(body.content)).toEqual({ text: 'hello-feishu' });
  });

  it('sends a card as msg_type=interactive when channelData.feishu.card is set', async () => {
    const fetchMock = queuedFetch([
      jsonResponse({ code: 0, tenant_access_token: 'tok-1', expire: 7200 }),
      jsonResponse({ code: 0, data: { message_id: 'om_card' } }),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const channel = makeChannel();
    await channel.connect();

    const card = { header: { title: { tag: 'plain_text', content: 'Hi' } }, elements: [] };
    const result = await channel.send({
      channelId: 'oc_chat2',
      content: 'fallback',
      channelData: { feishu: { card } },
    });

    expect(result.success).toBe(true);
    const [, msgInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(msgInit.body as string);
    expect(body.msg_type).toBe('interactive');
    expect(JSON.parse(body.content)).toEqual(card);
  });

  it('caches the tenant token across sends (no re-mint on the second send)', async () => {
    const fetchMock = queuedFetch([
      jsonResponse({ code: 0, tenant_access_token: 'tok-cache', expire: 7200 }),
      jsonResponse({ code: 0, data: { message_id: 'om_1' } }),
      jsonResponse({ code: 0, data: { message_id: 'om_2' } }),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const channel = makeChannel();
    await channel.connect();

    await channel.send({ channelId: 'oc_chat', content: 'one' });
    await channel.send({ channelId: 'oc_chat', content: 'two' });

    // 1 token mint + 2 message posts = 3 calls (token NOT re-fetched).
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((fetchMock.mock.calls[2]?.[0] as string)).toContain('/open-apis/im/v1/messages');
  });

  it('re-mints the token once on an expired-token code and retries the send', async () => {
    const fetchMock = queuedFetch([
      jsonResponse({ code: 0, tenant_access_token: 'stale', expire: 7200 }),
      // im/v1/messages rejects the stale token.
      jsonResponse({ code: 99991663, msg: 'tenant access token invalid' }),
      // re-mint
      jsonResponse({ code: 0, tenant_access_token: 'fresh', expire: 7200 }),
      // retry succeeds
      jsonResponse({ code: 0, data: { message_id: 'om_retry' } }),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const channel = makeChannel();
    await channel.connect();

    const result = await channel.send({ channelId: 'oc_chat', content: 'x' });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('om_retry');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // The retry used the freshly minted token.
    const [, retryInit] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect((retryInit.headers as Record<string, string>)['Authorization']).toBe('Bearer fresh');
  });

  it('returns a failed DeliveryResult when Feishu returns a non-zero code', async () => {
    const fetchMock = queuedFetch([
      jsonResponse({ code: 0, tenant_access_token: 'tok', expire: 7200 }),
      jsonResponse({ code: 230002, msg: 'bot is not in the chat' }),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const channel = makeChannel();
    await channel.connect();

    const result = await channel.send({ channelId: 'oc_chat', content: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('230002');
    expect(result.error).toContain('bot is not in the chat');
  });

  it('fails cleanly when the token exchange itself errors', async () => {
    const fetchMock = queuedFetch([
      jsonResponse({ code: 10003, msg: 'app not found' }),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const channel = makeChannel();
    await channel.connect();

    const result = await channel.send({ channelId: 'oc_chat', content: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('tenant_access_token');
  });

  it('rejects a send with no channelId', async () => {
    const channel = makeChannel();
    // connect() needs no network (token is minted lazily on send).
    vi.stubGlobal('fetch', vi.fn());
    await channel.connect();

    const result = await channel.send({ channelId: '', content: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('channelId');
  });
});

describe('FeishuChannel — honest inbound receive state', () => {
  afterEach(() => vi.restoreAllMocks());

  it('connect() does NOT claim a live inbound connection', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const channel = makeChannel();
    await channel.connect();

    const status = channel.getStatus();
    // The receive channel is not established — connect() must be honest.
    expect(status.connected).toBe(false);
    expect(status.error).toContain('long-connection');
    expect(status.info).toMatchObject({ outbound: 'ready', inbound: 'lark-sdk-required' });
  });

  it('getReceiveStatus() reports a structured "lark-sdk-required" reason', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const channel = makeChannel();

    // Before connect(), there is no status yet.
    expect(channel.getReceiveStatus()).toBeNull();

    await channel.connect();
    const recv = channel.getReceiveStatus();
    expect(recv).not.toBeNull();
    expect(recv?.connected).toBe(false);
    expect(recv?.reason).toBe('lark-sdk-required');
    expect(recv?.detail).toContain('Lark SDK');
  });

  it('disconnect() clears the honest error state and emits disconnected', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const channel = makeChannel();
    const disconnectedSpy = vi.fn();
    channel.on('disconnected', disconnectedSpy);

    await channel.connect();
    await channel.disconnect();

    expect(disconnectedSpy).toHaveBeenCalledWith('feishu');
    expect(channel.getReceiveStatus()).toBeNull();
    expect(channel.getStatus().error).toBeUndefined();
  });

  it('SDK-absent: connect() does not throw and stays in the honest send-only state', async () => {
    // @larksuiteoapi/node-sdk is NOT a dependency, so the optional dynamic
    // import inside connect() rejects → the channel must degrade gracefully to
    // outbound-only WITHOUT throwing.
    vi.stubGlobal('fetch', vi.fn());
    const channel = makeChannel();

    await expect(channel.connect()).resolves.toBeUndefined();

    const recv = channel.getReceiveStatus();
    expect(recv?.connected).toBe(false);
    expect(recv?.reason).toBe('lark-sdk-required');
    expect(channel.getStatus().connected).toBe(false);
    expect(channel.getStatus().info).toMatchObject({
      outbound: 'ready',
      inbound: 'lark-sdk-required',
    });
  });
});

// ============================================================================
// Inbound event parsing (im.message.receive_v1) — unit-tested in isolation.
//
// We cannot run the live long-connection here (it needs a real Feishu/Lark app
// + tenant credentials — an external-account gate). But the inbound WIRING is
// fully testable: inject a representative im.message.receive_v1 payload into the
// real parser/dispatch seam and assert the resulting InboundMessage + emits.
// ============================================================================

/** A representative `im.message.receive_v1` event body (unwrapped, as the SDK's
 *  EventDispatcher hands it to the handler). */
function makeReceiveEventBody(overrides: Partial<FeishuReceiveEventBody> = {}): FeishuReceiveEventBody {
  return {
    sender: {
      sender_id: { open_id: 'ou_sender123', union_id: 'on_union123', user_id: 'u_123' },
      sender_type: 'user',
      tenant_key: 'tk_1',
    },
    message: {
      message_id: 'om_msg123',
      create_time: '1700000000000',
      chat_id: 'oc_chat123',
      chat_type: 'p2p',
      message_type: 'text',
      content: JSON.stringify({ text: 'hello from feishu' }),
    },
    ...overrides,
  };
}

describe('parseFeishuMessageEvent() — inbound message parsing', () => {
  it('parses a text event into a Code Buddy InboundMessage', () => {
    const parsed = parseFeishuMessageEvent(makeReceiveEventBody());
    expect(parsed).not.toBeNull();
    const msg = parsed as InboundMessage;

    expect(msg.id).toBe('om_msg123');
    expect(msg.channel.id).toBe('oc_chat123');
    expect(msg.channel.type).toBe('feishu');
    expect(msg.channel.isDM).toBe(true);
    // sender is the open_id (preferred), with union/user_id as fallbacks.
    expect(msg.sender.id).toBe('ou_sender123');
    // content is the JSON-decoded text, NOT the raw `{"text":...}` string.
    expect(msg.content).toBe('hello from feishu');
    expect(msg.contentType).toBe('text');
    expect(msg.timestamp.getTime()).toBe(1700000000000);
  });

  it('falls back open_id → union_id → user_id for the sender id', () => {
    const noOpen = makeReceiveEventBody({
      sender: { sender_id: { union_id: 'on_union123', user_id: 'u_123' } },
    });
    expect(parseFeishuMessageEvent(noOpen)?.sender.id).toBe('on_union123');

    const onlyUser = makeReceiveEventBody({
      sender: { sender_id: { user_id: 'u_123' } },
    });
    expect(parseFeishuMessageEvent(onlyUser)?.sender.id).toBe('u_123');
  });

  it('is envelope-tolerant: accepts the full { schema, header, event } wrapper', () => {
    const parsed = parseFeishuMessageEvent({
      schema: '2.0',
      header: { event_type: 'im.message.receive_v1' },
      event: makeReceiveEventBody(),
    });
    expect(parsed?.content).toBe('hello from feishu');
    expect(parsed?.channel.id).toBe('oc_chat123');
  });

  it('extracts plain text from a post (rich-text) message', () => {
    const post = makeReceiveEventBody({
      message: {
        message_id: 'om_post',
        chat_id: 'oc_chat123',
        chat_type: 'group',
        create_time: '1700000000000',
        message_type: 'post',
        content: JSON.stringify({
          zh_cn: {
            title: 'Title',
            content: [[{ tag: 'text', text: 'first line' }], [{ tag: 'text', text: 'second' }]],
          },
        }),
      },
    });
    const parsed = parseFeishuMessageEvent(post);
    expect(parsed?.content).toContain('first line');
    expect(parsed?.content).toContain('second');
    expect(parsed?.channel.isGroup).toBe(true);
  });

  it('returns null for an event with no message body', () => {
    expect(parseFeishuMessageEvent({ sender: { sender_id: { open_id: 'x' } } })).toBeNull();
    expect(parseFeishuMessageEvent(undefined)).toBeNull();
    expect(parseFeishuMessageEvent(null)).toBeNull();
  });
});

describe('FeishuChannel.dispatchInboundEvent() — inbound emit wiring', () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits 'message' with the parsed InboundMessage (proves the handler wiring)", async () => {
    vi.stubGlobal('fetch', vi.fn());
    const channel = makeChannel();
    await channel.connect(); // SDK absent → send-only, but the seam still works.

    const messageSpy = vi.fn();
    const commandSpy = vi.fn();
    channel.on('message', messageSpy);
    channel.on('command', commandSpy);

    const result = channel.dispatchInboundEvent(makeReceiveEventBody());

    expect(result).not.toBeNull();
    expect(messageSpy).toHaveBeenCalledTimes(1);
    const emitted = messageSpy.mock.calls[0]?.[0] as InboundMessage;
    expect(emitted.content).toBe('hello from feishu');
    expect(emitted.sender.id).toBe('ou_sender123');
    // A plain (non-slash) message is not a command.
    expect(commandSpy).not.toHaveBeenCalled();
    expect(emitted.isCommand).toBeFalsy();
  });

  it("also emits 'command' for a message starting with '/'", async () => {
    vi.stubGlobal('fetch', vi.fn());
    const channel = makeChannel();
    await channel.connect();

    const messageSpy = vi.fn();
    const commandSpy = vi.fn();
    channel.on('message', messageSpy);
    channel.on('command', commandSpy);

    channel.dispatchInboundEvent(
      makeReceiveEventBody({
        message: {
          message_id: 'om_cmd',
          chat_id: 'oc_chat123',
          chat_type: 'p2p',
          create_time: '1700000000000',
          message_type: 'text',
          content: JSON.stringify({ text: '/help me' }),
        },
      }),
    );

    expect(messageSpy).toHaveBeenCalledTimes(1);
    expect(commandSpy).toHaveBeenCalledTimes(1);
    const cmd = commandSpy.mock.calls[0]?.[0] as InboundMessage;
    expect(cmd.isCommand).toBe(true);
    expect(cmd.commandName).toBe('help');
    expect(cmd.commandArgs).toEqual(['me']);
  });

  it('returns null and emits nothing for an event with no usable message', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const channel = makeChannel();
    await channel.connect();

    const messageSpy = vi.fn();
    channel.on('message', messageSpy);

    const result = channel.dispatchInboundEvent({ sender: { sender_id: { open_id: 'x' } } });
    expect(result).toBeNull();
    expect(messageSpy).not.toHaveBeenCalled();
  });
});
