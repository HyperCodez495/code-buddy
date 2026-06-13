/**
 * Tests for 7 new channel adapters:
 * iMessage, Nostr, LINE, Zalo, Twilio Voice, Mattermost, Nextcloud Talk
 */

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { IMessageAdapter, IMessageConfig } from '../../src/channels/imessage/index.js';
import { NostrAdapter, NostrConfig } from '../../src/channels/nostr/index.js';
import { LINEAdapter, LINEConfig } from '../../src/channels/line/index.js';
import { ZaloAdapter, ZaloConfig } from '../../src/channels/zalo/index.js';
import { TwilioVoiceAdapter, TwilioVoiceConfig } from '../../src/channels/twilio-voice/index.js';
import { MattermostAdapter, MattermostConfig } from '../../src/channels/mattermost/index.js';
import { NextcloudTalkAdapter, NextcloudTalkConfig } from '../../src/channels/nextcloud-talk/index.js';

// ============================================================================
// iMessage / BlueBubbles
// ============================================================================

describe('IMessageAdapter', () => {
  let adapter: IMessageAdapter;
  const config: IMessageConfig = {
    serverUrl: 'http://localhost:1234',
    password: 'test-password',
    port: 5555,
  };

  beforeEach(() => {
    adapter = new IMessageAdapter(config);
    // Mock global fetch for BlueBubbles API calls
    global.fetch = jest.fn().mockImplementation(async (url: string, opts?: { method?: string }) => ({
      ok: true,
      status: 200,
      json: async () => {
        if (url.includes('/api/v1/chat') && (!opts || opts.method !== 'POST')) return { status: 200, data: [] };
        if (url.includes('/api/v1/message') && (!opts || opts.method !== 'POST')) return { status: 200, data: [] };
        return { status: 200, message: 'OK', data: { guid: 'msg-123' } };
      },
    })) as jest.Mock;
  });

  afterEach(async () => {
    if (adapter.isRunning()) {
      await adapter.stop();
    }
    jest.restoreAllMocks();
  });

  it('should construct with config', () => {
    expect(adapter).toBeDefined();
    expect(adapter.isRunning()).toBe(false);
  });

  it('should return config via getConfig', () => {
    const cfg = adapter.getConfig();
    expect(cfg.serverUrl).toBe('http://localhost:1234');
    expect(cfg.password).toBe('test-password');
    expect(cfg.port).toBe(5555);
  });

  it('should apply default port when not provided', () => {
    const a = new IMessageAdapter({ serverUrl: 'http://localhost', password: 'pw' });
    expect(a.getConfig().port).toBe(1234);
  });

  it('should start and set running to true', async () => {
    await adapter.start();
    expect(adapter.isRunning()).toBe(true);
  });

  it('should throw when starting twice', async () => {
    await adapter.start();
    await expect(adapter.start()).rejects.toThrow('already running');
  });

  it('should stop and set running to false', async () => {
    await adapter.start();
    await adapter.stop();
    expect(adapter.isRunning()).toBe(false);
  });

  it('should throw when stopping while not running', async () => {
    await expect(adapter.stop()).rejects.toThrow('not running');
  });

  it('should send a message when running', async () => {
    await adapter.start();
    const result = await adapter.sendMessage('chat-1', 'Hello');
    expect(result.success).toBe(true);
    expect(result.messageGuid).toBeDefined();
  });

  it('should throw sendMessage when not running', async () => {
    await expect(adapter.sendMessage('chat-1', 'Hello')).rejects.toThrow('not running');
  });

  it('should send a reaction when running', async () => {
    await adapter.start();
    const result = await adapter.sendReaction('chat-1', 'msg-1', 'love');
    expect(result.success).toBe(true);
  });

  it('should throw sendReaction when not running', async () => {
    await expect(adapter.sendReaction('chat-1', 'msg-1', 'love')).rejects.toThrow('not running');
  });

  it('should return empty chats list', async () => {
    await adapter.start();
    const chats = await adapter.getChats();
    expect(chats).toEqual([]);
  });

  it('should return empty messages list', async () => {
    await adapter.start();
    const messages = await adapter.getMessages('chat-1', 10);
    expect(messages).toEqual([]);
  });

  it('should not mutate original config', () => {
    const original = { serverUrl: 'http://test', password: 'pw' };
    const a = new IMessageAdapter(original);
    const returned = a.getConfig();
    returned.serverUrl = 'http://changed';
    expect(a.getConfig().serverUrl).toBe('http://test');
  });
});

// ============================================================================
// iMessage / BlueBubbles — reconnection (ReconnectionManager wiring)
// ============================================================================

describe('IMessageAdapter reconnection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * Build a fetch mock whose poll requests fail, but whose health-check
   * (/server/info) requests are configurable. `pollOk` controls the polling
   * endpoint; `healthOk` controls the reconnect health check.
   */
  function makeFetch(opts: { healthOk: boolean }) {
    return vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/server/info')) {
        // health check
        return { ok: opts.healthOk, status: opts.healthOk ? 200 : 503, json: async () => ({}), text: async () => '' };
      }
      // polling endpoint — always fails to drive the retry path
      return { ok: false, status: 500, statusText: 'err', json: async () => ({}), text: async () => 'boom' };
    }) as unknown as typeof fetch;
  }

  it('routes repeated polling failures through ReconnectionManager.scheduleReconnect', async () => {
    vi.useFakeTimers();
    // Health check succeeds on connect, then the poll loop fails repeatedly.
    let healthOk = true;
    global.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/server/info')) {
        return { ok: healthOk, status: healthOk ? 200 : 503, json: async () => ({}), text: async () => '' };
      }
      return { ok: false, status: 500, statusText: 'err', json: async () => ({}), text: async () => 'boom' };
    }) as unknown as typeof fetch;

    const adapter = new IMessageAdapter({
      serverUrl: 'http://localhost',
      password: 'pw',
      pollingInterval: 10,
      maxRetries: 3,
      retryDelay: 50,
    });
    adapter.on('error', () => {}); // swallow the error emitted on max-retry

    // Spy on the manager that lives on the adapter instance.
    const mgr = (adapter as unknown as { reconnectionManager: { scheduleReconnect: (fn: () => Promise<void>) => void } }).reconnectionManager;
    const scheduleSpy = vi.spyOn(mgr, 'scheduleReconnect');

    await adapter.start();
    expect(adapter.isRunning()).toBe(true);

    // From here the health check should report DOWN so reconnect attempts fail.
    healthOk = false;

    // Advance enough poll cycles to exceed maxRetries (3) and trigger reconnect.
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(10);
    }

    expect(scheduleSpy).toHaveBeenCalled();
    // The connect-time healthCheck plus polling attempts all went through fetch.
    expect((global.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(3);

    await adapter.stop().catch(() => {});
  });

  it('recovers (emits "reconnected") when the health check passes on a reconnect attempt', async () => {
    vi.useFakeTimers();
    global.fetch = makeFetch({ healthOk: true });

    const adapter = new IMessageAdapter({
      serverUrl: 'http://localhost',
      password: 'pw',
      pollingInterval: 10,
      maxRetries: 2,
      retryDelay: 20,
    });
    adapter.on('error', () => {});
    const reconnected = vi.fn();
    adapter.on('reconnected', reconnected);

    await adapter.start();
    // Drive the poll loop past maxRetries → reconnect scheduled. The manager's
    // backoff delay includes up to 500ms of random jitter on top of the 20ms
    // base, so advance generously (well past base+maxJitter) to deterministically
    // fire the scheduled reconnect closure regardless of the jitter draw.
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(100);
    }

    // health check succeeds, so the reconnect closure should have re-armed
    // polling and emitted 'reconnected'.
    expect(reconnected).toHaveBeenCalled();

    await adapter.stop().catch(() => {});
  });

  it('cancel()s any pending reconnect on stop()', async () => {
    vi.useFakeTimers();
    let healthOk = true;
    global.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/server/info')) {
        return { ok: healthOk, status: healthOk ? 200 : 503, json: async () => ({}), text: async () => '' };
      }
      return { ok: false, status: 500, statusText: 'err', json: async () => ({}), text: async () => 'boom' };
    }) as unknown as typeof fetch;

    const adapter = new IMessageAdapter({
      serverUrl: 'http://localhost',
      password: 'pw',
      pollingInterval: 10,
      maxRetries: 2,
      retryDelay: 10_000, // long delay so the reconnect stays pending
    });
    adapter.on('error', () => {});

    const mgr = (adapter as unknown as { reconnectionManager: { cancel: () => void; isPending: () => boolean } }).reconnectionManager;
    const cancelSpy = vi.spyOn(mgr, 'cancel');

    await adapter.start();
    healthOk = false;
    // Trigger a reconnect schedule (pending due to long retryDelay).
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(mgr.isPending()).toBe(true);

    await adapter.stop();
    expect(cancelSpy).toHaveBeenCalled();
    expect(mgr.isPending()).toBe(false);
    expect(adapter.isRunning()).toBe(false);
  });

  it('retries repeatedly and finally gives up (running=false, emits "disconnected") on a sustained outage', async () => {
    vi.useFakeTimers();
    let healthOk = true; // OK on connect, then forced down for the whole outage
    global.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/server/info')) {
        return { ok: healthOk, status: healthOk ? 200 : 503, json: async () => ({}), text: async () => '' };
      }
      return { ok: false, status: 500, statusText: 'err', json: async () => ({}), text: async () => 'boom' };
    }) as unknown as typeof fetch;

    const adapter = new IMessageAdapter({
      serverUrl: 'http://localhost',
      password: 'pw',
      pollingInterval: 10,
      maxRetries: 3,
      retryDelay: 20,
    });
    adapter.on('error', () => {});
    const disconnected = vi.fn();
    adapter.on('disconnected', disconnected);

    const mgr = (adapter as unknown as {
      reconnectionManager: { scheduleReconnect: (fn: () => Promise<void>) => void };
    }).reconnectionManager;
    const scheduleSpy = vi.spyOn(mgr, 'scheduleReconnect');

    await adapter.start();
    healthOk = false; // sustained outage: every poll AND every reconnect fails

    // Advance well past base delay + max jitter (500ms) across many cycles so
    // each scheduled attempt fires, fails, and re-drives the next attempt.
    for (let i = 0; i < 60; i++) {
      await vi.advanceTimersByTimeAsync(100);
    }

    // The single-shot manager must have been re-driven more than once...
    expect(scheduleSpy.mock.calls.length).toBeGreaterThan(1);
    // ...and the sustained outage must eventually be surfaced as a permanent
    // failure rather than silently wedging the adapter.
    expect(disconnected).toHaveBeenCalled();
    expect(adapter.isRunning()).toBe(false);

    // --- Second episode: a fresh start() must NOT inherit a pre-exhausted
    // retryCount from episode 1, otherwise the next immediate-failure outage
    // would give up after a single attempt.
    const episode1Calls = scheduleSpy.mock.calls.length;
    healthOk = true; // BlueBubbles briefly back up so start()'s health check passes
    await adapter.start();
    expect(adapter.isRunning()).toBe(true);

    healthOk = false; // drops again before any poll succeeds
    for (let i = 0; i < 60; i++) {
      await vi.advanceTimersByTimeAsync(100);
    }

    const episode2Calls = scheduleSpy.mock.calls.length - episode1Calls;
    // The second episode must get a real retry budget (> 1 attempt), proving
    // the manager's backoff state was reset on the new session.
    expect(episode2Calls).toBeGreaterThan(1);

    await adapter.stop().catch(() => {});
  });
});

// ============================================================================
// Nostr
// ============================================================================

describe('NostrAdapter', () => {
  let adapter: NostrAdapter;
  const config: NostrConfig = {
    privateKey: 'nsec1test',
    relays: ['wss://relay.damus.io', 'wss://nos.lol'],
  };

  beforeEach(() => {
    adapter = new NostrAdapter(config);
  });

  afterEach(async () => {
    if (adapter.isRunning()) {
      await adapter.stop();
    }
  });

  it('should construct with config', () => {
    expect(adapter).toBeDefined();
    expect(adapter.isRunning()).toBe(false);
  });

  it('should return config via getConfig', () => {
    const cfg = adapter.getConfig();
    expect(cfg.privateKey).toBe('nsec1test');
    expect(cfg.relays).toEqual(['wss://relay.damus.io', 'wss://nos.lol']);
  });

  it('should start and populate connected relays', async () => {
    await adapter.start();
    expect(adapter.isRunning()).toBe(true);
    expect(adapter.getRelays()).toEqual(['wss://relay.damus.io', 'wss://nos.lol']);
  });

  it('should throw when starting twice', async () => {
    await adapter.start();
    await expect(adapter.start()).rejects.toThrow('already running');
  });

  it('should stop and clear relays', async () => {
    await adapter.start();
    await adapter.stop();
    expect(adapter.isRunning()).toBe(false);
    expect(adapter.getRelays()).toEqual([]);
  });

  it('should throw when stopping while not running', async () => {
    await expect(adapter.stop()).rejects.toThrow('not running');
  });

  it('should send direct message when running', async () => {
    await adapter.start();
    const result = await adapter.sendDirectMessage('npub1abc', 'Hello Nostr');
    expect(result.success).toBe(true);
    expect(result.eventId).toBeDefined();
  });

  it('should throw sendDirectMessage when not running', async () => {
    await expect(adapter.sendDirectMessage('npub1abc', 'Hello')).rejects.toThrow('not running');
  });

  it('should derive a deterministic npub public key', () => {
    const pubkey = adapter.getPublicKey();
    expect(pubkey).toContain('npub1');
    expect(pubkey).not.toContain('placeholder');

    const adapter2 = new NostrAdapter(config);
    expect(adapter2.getPublicKey()).toBe(pubkey);
  });

  it('should add a relay', async () => {
    await adapter.start();
    adapter.addRelay('wss://new-relay.example');
    expect(adapter.getRelays()).toContain('wss://new-relay.example');
  });

  it('should not add duplicate relay', async () => {
    await adapter.start();
    adapter.addRelay('wss://relay.damus.io');
    expect(adapter.getRelays().filter(r => r === 'wss://relay.damus.io')).toHaveLength(1);
  });

  it('should remove a relay', async () => {
    await adapter.start();
    adapter.removeRelay('wss://nos.lol');
    expect(adapter.getRelays()).not.toContain('wss://nos.lol');
  });

  it('should handle removing non-existent relay', async () => {
    await adapter.start();
    adapter.removeRelay('wss://nonexistent');
    expect(adapter.getRelays()).toHaveLength(2);
  });

  it('should not mutate original config relays', () => {
    const original: NostrConfig = { relays: ['wss://a'] };
    const a = new NostrAdapter(original);
    a.getConfig().relays.push('wss://b');
    expect(a.getConfig().relays).toEqual(['wss://a']);
  });
});

// ============================================================================
// LINE
// ============================================================================

describe('LINEAdapter', () => {
  let adapter: LINEAdapter;
  const config: LINEConfig = {
    channelAccessToken: 'token-123',
    channelSecret: 'secret-456',
    port: 9090,
  };

  beforeEach(() => {
    adapter = new LINEAdapter(config);
  });

  afterEach(async () => {
    if (adapter.isRunning()) {
      await adapter.stop();
    }
  });

  it('should construct with config', () => {
    expect(adapter).toBeDefined();
    expect(adapter.isRunning()).toBe(false);
  });

  it('should return config via getConfig', () => {
    const cfg = adapter.getConfig();
    expect(cfg.channelAccessToken).toBe('token-123');
    expect(cfg.channelSecret).toBe('secret-456');
    expect(cfg.port).toBe(9090);
  });

  it('should apply default port', () => {
    const a = new LINEAdapter({ channelAccessToken: 't', channelSecret: 's' });
    expect(a.getConfig().port).toBe(8080);
  });

  it('should start and stop', async () => {
    await adapter.start();
    expect(adapter.isRunning()).toBe(true);
    await adapter.stop();
    expect(adapter.isRunning()).toBe(false);
  });

  it('should throw when starting twice', async () => {
    await adapter.start();
    await expect(adapter.start()).rejects.toThrow('already running');
  });

  it('should throw when stopping while not running', async () => {
    await expect(adapter.stop()).rejects.toThrow('not running');
  });

  it('should send message when running', async () => {
    await adapter.start();
    const result = await adapter.sendMessage('user-1', 'Hello LINE');
    expect(result.success).toBe(true);
  });

  it('should throw sendMessage when not running', async () => {
    await expect(adapter.sendMessage('user-1', 'Hello')).rejects.toThrow('not running');
  });

  it('should send image when running', async () => {
    await adapter.start();
    const result = await adapter.sendImage('user-1', 'https://example.com/img.png');
    expect(result.success).toBe(true);
  });

  it('should send sticker when running', async () => {
    await adapter.start();
    const result = await adapter.sendSticker('user-1', 'pkg-1', 'stk-1');
    expect(result.success).toBe(true);
  });

  it('should get user profile when running', async () => {
    await adapter.start();
    const profile = await adapter.getProfile('user-1');
    expect(profile.userId).toBe('user-1');
    expect(profile.displayName).toBeDefined();
  });

  it('should throw getProfile when not running', async () => {
    await expect(adapter.getProfile('user-1')).rejects.toThrow('not running');
  });
});

// ============================================================================
// Zalo
// ============================================================================

describe('ZaloAdapter', () => {
  let adapter: ZaloAdapter;
  const config: ZaloConfig = {
    appId: 'app-123',
    secretKey: 'secret-abc',
    mode: 'bot',
  };

  beforeEach(() => {
    adapter = new ZaloAdapter(config);
  });

  afterEach(async () => {
    if (adapter.isRunning()) {
      await adapter.stop();
    }
  });

  it('should construct with config', () => {
    expect(adapter).toBeDefined();
    expect(adapter.isRunning()).toBe(false);
  });

  it('should return config via getConfig', () => {
    const cfg = adapter.getConfig();
    expect(cfg.appId).toBe('app-123');
    expect(cfg.secretKey).toBe('secret-abc');
    expect(cfg.mode).toBe('bot');
  });

  it('should start and stop', async () => {
    await adapter.start();
    expect(adapter.isRunning()).toBe(true);
    await adapter.stop();
    expect(adapter.isRunning()).toBe(false);
  });

  it('should throw when starting twice', async () => {
    await adapter.start();
    await expect(adapter.start()).rejects.toThrow('already running');
  });

  it('should throw when stopping while not running', async () => {
    await expect(adapter.stop()).rejects.toThrow('not running');
  });

  it('should send message when running', async () => {
    await adapter.start();
    const result = await adapter.sendMessage('user-1', 'Xin chao');
    expect(result.success).toBe(true);
  });

  it('should throw sendMessage when not running', async () => {
    await expect(adapter.sendMessage('user-1', 'Hello')).rejects.toThrow('not running');
  });

  it('should send image when running', async () => {
    await adapter.start();
    const result = await adapter.sendImage('user-1', 'https://example.com/img.png');
    expect(result.success).toBe(true);
  });

  it('should return mode as bot', () => {
    expect(adapter.getMode()).toBe('bot');
  });

  it('should return mode as personal', () => {
    const a = new ZaloAdapter({ appId: 'x', secretKey: 'y', mode: 'personal' });
    expect(a.getMode()).toBe('personal');
  });
});

// ============================================================================
// Twilio Voice
// ============================================================================

describe('TwilioVoiceAdapter', () => {
  let adapter: TwilioVoiceAdapter;
  const config: TwilioVoiceConfig = {
    accountSid: 'AC123',
    authToken: 'auth-token',
    phoneNumber: '+15551234567',
    webhookUrl: 'https://example.com/voice',
  };

  beforeEach(() => {
    adapter = new TwilioVoiceAdapter(config);
  });

  afterEach(async () => {
    if (adapter.isRunning()) {
      await adapter.stop();
    }
  });

  it('should construct with config', () => {
    expect(adapter).toBeDefined();
    expect(adapter.isRunning()).toBe(false);
  });

  it('should return config via getConfig', () => {
    const cfg = adapter.getConfig();
    expect(cfg.accountSid).toBe('AC123');
    expect(cfg.phoneNumber).toBe('+15551234567');
    expect(cfg.webhookUrl).toBe('https://example.com/voice');
  });

  it('should start and stop', async () => {
    await adapter.start();
    expect(adapter.isRunning()).toBe(true);
    await adapter.stop();
    expect(adapter.isRunning()).toBe(false);
  });

  it('should throw when starting twice', async () => {
    await adapter.start();
    await expect(adapter.start()).rejects.toThrow('already running');
  });

  it('should throw when stopping while not running', async () => {
    await expect(adapter.stop()).rejects.toThrow('not running');
  });

  it('should make a call and track it', async () => {
    await adapter.start();
    const result = await adapter.makeCall('+15559876543', 'Hello caller');
    expect(result.success).toBe(true);
    expect(result.callSid).toBeDefined();
    expect(adapter.getActiveCalls()).toHaveLength(1);
  });

  it('should throw makeCall when not running', async () => {
    await expect(adapter.makeCall('+1555', 'Hello')).rejects.toThrow('not running');
  });

  it('should end a call and remove it from active calls', async () => {
    await adapter.start();
    const { callSid } = await adapter.makeCall('+15559876543', 'Hello');
    const result = await adapter.endCall(callSid);
    expect(result.success).toBe(true);
    expect(adapter.getActiveCalls()).toHaveLength(0);
  });

  it('should return success=false when ending non-existent call', async () => {
    await adapter.start();
    const result = await adapter.endCall('CA_nonexistent');
    expect(result.success).toBe(false);
  });

  it('should clear active calls on stop', async () => {
    await adapter.start();
    await adapter.makeCall('+15551111111', 'Call 1');
    await adapter.makeCall('+15552222222', 'Call 2');
    expect(adapter.getActiveCalls()).toHaveLength(2);
    await adapter.stop();
    expect(adapter.getActiveCalls()).toHaveLength(0);
  });

  it('should generate valid TwiML', () => {
    const twiml = adapter.generateTwiML('Hello world');
    expect(twiml).toContain('<?xml');
    expect(twiml).toContain('<Response>');
    expect(twiml).toContain('<Say>Hello world</Say>');
    expect(twiml).toContain('</Response>');
  });

  it('should escape XML entities in TwiML', () => {
    const twiml = adapter.generateTwiML('Hello <world> & "friends"');
    expect(twiml).toContain('&lt;world&gt;');
    expect(twiml).toContain('&amp;');
    expect(twiml).toContain('&quot;friends&quot;');
  });
});

// ============================================================================
// Mattermost
// ============================================================================

describe('MattermostAdapter', () => {
  let adapter: MattermostAdapter;
  const config: MattermostConfig = {
    url: 'https://mattermost.example.com',
    token: 'mm-token-123',
    teamId: 'team-abc',
  };

  beforeEach(() => {
    adapter = new MattermostAdapter(config);
  });

  afterEach(async () => {
    if (adapter.isRunning()) {
      await adapter.stop();
    }
  });

  it('should construct with config', () => {
    expect(adapter).toBeDefined();
    expect(adapter.isRunning()).toBe(false);
  });

  it('should return config via getConfig', () => {
    const cfg = adapter.getConfig();
    expect(cfg.url).toBe('https://mattermost.example.com');
    expect(cfg.token).toBe('mm-token-123');
    expect(cfg.teamId).toBe('team-abc');
  });

  it('should start and stop', async () => {
    await adapter.start();
    expect(adapter.isRunning()).toBe(true);
    await adapter.stop();
    expect(adapter.isRunning()).toBe(false);
  });

  it('should throw when starting twice', async () => {
    await adapter.start();
    await expect(adapter.start()).rejects.toThrow('already running');
  });

  it('should throw when stopping while not running', async () => {
    await expect(adapter.stop()).rejects.toThrow('not running');
  });

  it('should send message when running', async () => {
    await adapter.start();
    const result = await adapter.sendMessage('channel-1', 'Hello Mattermost');
    expect(result.success).toBe(true);
    expect(result.postId).toBeDefined();
  });

  it('should throw sendMessage when not running', async () => {
    await expect(adapter.sendMessage('channel-1', 'Hello')).rejects.toThrow('not running');
  });

  it('should send reply when running', async () => {
    await adapter.start();
    const result = await adapter.sendReply('channel-1', 'root-msg-1', 'Reply text');
    expect(result.success).toBe(true);
    expect(result.postId).toContain('reply');
  });

  it('should return empty channels list', async () => {
    await adapter.start();
    const channels = await adapter.getChannels();
    expect(channels).toEqual([]);
  });

  it('should work without optional teamId', () => {
    const a = new MattermostAdapter({ url: 'https://mm.test', token: 'tok' });
    const cfg = a.getConfig();
    expect(cfg.teamId).toBeUndefined();
  });
});

// ============================================================================
// Nextcloud Talk
// ============================================================================

describe('NextcloudTalkAdapter', () => {
  let adapter: NextcloudTalkAdapter;
  const config: NextcloudTalkConfig = {
    url: 'https://nextcloud.example.com',
    username: 'admin',
    password: 'admin-pass',
  };

  beforeEach(() => {
    adapter = new NextcloudTalkAdapter(config);
  });

  afterEach(async () => {
    if (adapter.isRunning()) {
      await adapter.stop();
    }
  });

  it('should construct with config', () => {
    expect(adapter).toBeDefined();
    expect(adapter.isRunning()).toBe(false);
  });

  it('should return config via getConfig', () => {
    const cfg = adapter.getConfig();
    expect(cfg.url).toBe('https://nextcloud.example.com');
    expect(cfg.username).toBe('admin');
    expect(cfg.password).toBe('admin-pass');
  });

  it('should start and stop', async () => {
    await adapter.start();
    expect(adapter.isRunning()).toBe(true);
    await adapter.stop();
    expect(adapter.isRunning()).toBe(false);
  });

  it('should throw when starting twice', async () => {
    await adapter.start();
    await expect(adapter.start()).rejects.toThrow('already running');
  });

  it('should throw when stopping while not running', async () => {
    await expect(adapter.stop()).rejects.toThrow('not running');
  });

  it('should send message when running', async () => {
    await adapter.start();
    const result = await adapter.sendMessage('room-abc', 'Hello Nextcloud');
    expect(result.success).toBe(true);
    expect(result.messageId).toBeDefined();
  });

  it('should throw sendMessage when not running', async () => {
    await expect(adapter.sendMessage('room-abc', 'Hello')).rejects.toThrow('not running');
  });

  it('should return empty rooms list', async () => {
    await adapter.start();
    const rooms = await adapter.getRooms();
    expect(rooms).toEqual([]);
  });

  it('should join a room', async () => {
    await adapter.start();
    const result = await adapter.joinRoom('room-abc');
    expect(result.success).toBe(true);
  });

  it('should leave a room that was joined', async () => {
    await adapter.start();
    await adapter.joinRoom('room-abc');
    const result = await adapter.leaveRoom('room-abc');
    expect(result.success).toBe(true);
  });

  it('should return success=false when leaving non-joined room', async () => {
    await adapter.start();
    const result = await adapter.leaveRoom('room-nonexistent');
    expect(result.success).toBe(false);
  });

  it('should clear joined rooms on stop', async () => {
    await adapter.start();
    await adapter.joinRoom('room-1');
    await adapter.joinRoom('room-2');
    await adapter.stop();
    // After restart, rooms should be empty
    await adapter.start();
    const result = await adapter.leaveRoom('room-1');
    expect(result.success).toBe(false);
  });
});
