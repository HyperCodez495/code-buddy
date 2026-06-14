/**
 * Nextcloud Talk Channel Adapter
 *
 * Connects to Nextcloud Talk (Spreed) for messaging via the real Spreed chat
 * REST API using an HTTP long-poll receive loop (`lookIntoFuture=1`), with
 * auto-reconnect through the shared ReconnectionManager (same idiom as
 * imessage/irc/discord/slack).
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/logger.js';
import {
  BaseChannel,
  ChannelConfig,
  ContentType,
  DeliveryResult,
  InboundMessage,
  OutboundMessage,
} from '../core.js';
import { ReconnectionManager } from '../reconnection-manager.js';

// ============================================================================
// Legacy in-process adapter (retained — DO NOT delete)
// ----------------------------------------------------------------------------
// NextcloudTalkAdapter is a lightweight in-process stub used for lifecycle /
// room-flow unit tests in tests/channels/new-channels.test.ts (outside this
// task's editable set). Its behavior must stay identical. The REAL long-poll
// transport lives in NextcloudTalkClient / NextcloudTalkChannel below.
// ============================================================================

export interface NextcloudTalkConfig {
  url: string;
  username: string;
  password: string;
}

export class NextcloudTalkAdapter {
  private config: NextcloudTalkConfig;
  private running = false;
  private joinedRooms: Set<string> = new Set();

  constructor(config: NextcloudTalkConfig) {
    this.config = { ...config };
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('NextcloudTalkAdapter is already running');
    }
    logger.debug('NextcloudTalkAdapter: connecting', { url: this.config.url, username: this.config.username });
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('NextcloudTalkAdapter is not running');
    }
    logger.debug('NextcloudTalkAdapter: disconnecting');
    this.joinedRooms.clear();
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(roomToken: string, text: string): Promise<{ success: boolean; messageId: string }> {
    if (!this.running) {
      throw new Error('NextcloudTalkAdapter is not running');
    }
    logger.debug('NextcloudTalkAdapter: sending message', { roomToken, textLength: text.length });
    return { success: true, messageId: `nc_${Date.now()}` };
  }

  async getRooms(): Promise<Array<{ token: string; name: string; type: number }>> {
    if (!this.running) {
      throw new Error('NextcloudTalkAdapter is not running');
    }
    return [];
  }

  async joinRoom(roomToken: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('NextcloudTalkAdapter is not running');
    }
    this.joinedRooms.add(roomToken);
    logger.debug('NextcloudTalkAdapter: joined room', { roomToken });
    return { success: true };
  }

  async leaveRoom(roomToken: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('NextcloudTalkAdapter is not running');
    }
    const existed = this.joinedRooms.delete(roomToken);
    logger.debug('NextcloudTalkAdapter: left room', { roomToken, existed });
    return { success: existed };
  }

  getConfig(): NextcloudTalkConfig {
    return { ...this.config };
  }
}

// ============================================================================
// Real Spreed chat long-poll transport
// ============================================================================

export interface NextcloudTalkChannelConfig extends ChannelConfig {
  /** Base Nextcloud URL, e.g. https://cloud.example.com (no trailing slash needed). */
  url: string;
  /** Nextcloud user for HTTP Basic auth. */
  username: string;
  /** App password / login password for HTTP Basic auth. */
  password: string;
  /** Optional explicit app password (preferred over `password` if set). */
  appPassword?: string;
  /** Optional bearer token — used instead of Basic auth when provided. */
  token?: string;
  bearer?: string;
  /** Conversation/room token to long-poll for inbound messages. */
  roomToken?: string;
  /** Long-poll hold timeout in seconds (server-side). Default 30. */
  pollTimeoutSecs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

/** Shape of a single message inside `ocs.data[]` from the Spreed chat API. */
interface SpreedChatMessage {
  id: number;
  token?: string;
  actorId?: string;
  actorDisplayName?: string;
  actorType?: string;
  message?: string;
  timestamp?: number;
  systemMessage?: string;
}

interface SpreedChatEnvelope {
  ocs?: {
    meta?: { status?: string; statuscode?: number; message?: string };
    data?: SpreedChatMessage[];
  };
}

const SPREED_CHAT_PATH = '/ocs/v2.php/apps/spreed/api/v1/chat';

/**
 * Real Nextcloud Talk (Spreed) client. Holds one outstanding long-poll request
 * against `chat/<roomToken>?lookIntoFuture=1` at a time; the server returns 200
 * with new messages or 304 on timeout. Drops are recovered via the shared
 * ReconnectionManager. This is a genuinely persistent connection model — the
 * same shape as imessage/irc.
 */
export class NextcloudTalkClient extends EventEmitter {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly bearer: string | undefined;
  private readonly roomToken: string;
  private readonly pollTimeoutSecs: number;

  private running = false;
  /** True while an intentional disconnect is in progress — suppresses reconnect. */
  private closing = false;
  private reconnecting = false;
  private lastKnownMessageId = 0;
  /** AbortController for the in-flight long-poll request. */
  private pollAbort: AbortController | null = null;
  private readonly reconnectionManager: ReconnectionManager;

  constructor(config: NextcloudTalkChannelConfig) {
    super();
    this.baseUrl = config.url.replace(/\/+$/, '');
    this.username = config.username;
    this.password = config.appPassword ?? config.password;
    this.bearer = config.bearer ?? config.token;
    this.roomToken = config.roomToken ?? '';
    this.pollTimeoutSecs = config.pollTimeoutSecs ?? 30;
    this.reconnectionManager = new ReconnectionManager('nextcloud-talk', {
      maxRetries: config.maxRetries ?? 10,
      initialDelayMs: config.retryDelayMs ?? 2000,
      maxDelayMs: 60000,
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  getRoomToken(): string {
    return this.roomToken;
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Begin the long-poll receive loop. Returns immediately — `connect()` does
   * NOT block on the first poll (a long-poll can hold open up to
   * `pollTimeoutSecs`). The first successful poll (200 or 304) emits
   * 'connected'.
   */
  start(): void {
    if (this.running) {
      throw new Error('NextcloudTalkClient is already running');
    }
    this.running = true;
    this.closing = false;
    // Fresh session — clear any inherited backoff state.
    this.reconnectionManager.onConnected();
    logger.debug('NextcloudTalkClient: starting long-poll loop', {
      url: this.baseUrl,
      room: this.roomToken,
    });
    void this.runPollLoop();
  }

  /**
   * Stop the loop, abort the in-flight request, and cancel any pending
   * reconnect. Idempotent.
   */
  stop(): void {
    if (!this.running && !this.closing) {
      return;
    }
    this.closing = true;
    this.running = false;
    this.reconnecting = false;
    this.reconnectionManager.cancel();
    if (this.pollAbort) {
      this.pollAbort.abort();
      this.pollAbort = null;
    }
    logger.debug('NextcloudTalkClient: stopped');
  }

  // --------------------------------------------------------------------------
  // Receive (long-poll)
  // --------------------------------------------------------------------------

  private async runPollLoop(): Promise<void> {
    while (this.running && !this.closing) {
      try {
        await this.pollOnce();
        // A successful poll (messages or 304 timeout) means the link is
        // healthy — reset shared backoff so a future drop starts at delay 0.
        this.reconnectionManager.onConnected();
        this.reconnecting = false;
        this.onConnectedOnce();
      } catch (err) {
        // Intentional teardown — exit silently, never reconnect.
        if (this.closing || !this.running || this.isAbortError(err)) {
          return;
        }
        const error = err instanceof Error ? err : new Error(String(err));
        logger.warn('NextcloudTalkClient: poll error, scheduling reconnect', {
          error: error.message,
        });
        // Surface the error, but only when a listener exists — a bare
        // EventEmitter 'error' with no listener throws and would abort the
        // reconnect we're about to schedule. Scheduling comes first regardless.
        this.scheduleReconnect();
        if (this.listenerCount('error') > 0) {
          this.emit('error', error);
        }
        // Hand control to the ReconnectionManager — it owns the retry cadence.
        return;
      }
    }
  }

  /**
   * Issue one long-poll request. Resolves on 200 (with messages emitted) or 304
   * (timeout, no messages). Throws on network failure / non-2xx-non-304 status
   * (a real drop → triggers reconnect).
   */
  private async pollOnce(): Promise<void> {
    const params = new URLSearchParams({
      lookIntoFuture: '1',
      timeout: String(this.pollTimeoutSecs),
      lastKnownMessageId: String(this.lastKnownMessageId),
      setReadMarker: '0',
    });
    const url = `${this.baseUrl}${SPREED_CHAT_PATH}/${encodeURIComponent(this.roomToken)}?${params.toString()}`;

    // Abort the request slightly after the server-side hold timeout so a wedged
    // connection can't pin the loop forever.
    const abort = new AbortController();
    this.pollAbort = abort;
    const watchdog = setTimeout(() => abort.abort(), (this.pollTimeoutSecs + 10) * 1000);
    watchdog.unref?.();

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: abort.signal,
      });
    } finally {
      clearTimeout(watchdog);
      if (this.pollAbort === abort) {
        this.pollAbort = null;
      }
    }

    // 304 = long-poll timed out with no new messages — a SUCCESSFUL empty poll,
    // not an error and not a reconnect trigger.
    if (response.status === 304) {
      return;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Nextcloud Talk poll failed: ${response.status} ${response.statusText} - ${body}`);
    }

    const lastGiven = response.headers.get('X-Chat-Last-Given');
    const envelope = (await response.json().catch(() => ({}))) as SpreedChatEnvelope;
    const messages = envelope.ocs?.data ?? [];

    let maxId = this.lastKnownMessageId;
    for (const raw of messages) {
      if (typeof raw.id === 'number' && raw.id > maxId) {
        maxId = raw.id;
      }
      // Skip system messages (joins/leaves/etc.) — they have no user content.
      if (raw.systemMessage) {
        continue;
      }
      this.emit('message', this.toInbound(raw));
    }

    // Advance the cursor from the server-provided header when present, else from
    // the max message id we saw.
    const givenId = lastGiven ? Number.parseInt(lastGiven, 10) : NaN;
    if (Number.isFinite(givenId) && givenId > this.lastKnownMessageId) {
      this.lastKnownMessageId = givenId;
    } else if (maxId > this.lastKnownMessageId) {
      this.lastKnownMessageId = maxId;
    }
  }

  private toInbound(raw: SpreedChatMessage): InboundMessage {
    const sender = raw.actorId ?? 'unknown';
    const content = raw.message ?? '';
    const isCommand = content.startsWith('/');
    const contentType: ContentType = isCommand ? 'command' : 'text';
    const message: InboundMessage = {
      id: String(raw.id),
      channel: {
        id: raw.token ?? this.roomToken,
        type: 'nextcloud-talk',
        name: raw.token ?? this.roomToken,
        isGroup: true,
      },
      sender: {
        id: sender,
        username: sender,
        displayName: raw.actorDisplayName ?? sender,
        isBot: raw.actorType === 'bots',
      },
      content,
      contentType,
      timestamp: raw.timestamp ? new Date(raw.timestamp * 1000) : new Date(),
      raw,
    };
    if (isCommand) {
      const parts = content.slice(1).split(/\s+/);
      message.isCommand = true;
      message.commandName = parts[0];
      message.commandArgs = parts.slice(1);
    }
    return message;
  }

  /** Emit 'connected' exactly once per session (on first successful poll). */
  private connectedEmitted = false;
  private onConnectedOnce(): void {
    if (!this.connectedEmitted) {
      this.connectedEmitted = true;
      this.emit('connected');
    }
  }

  // --------------------------------------------------------------------------
  // Reconnection
  // --------------------------------------------------------------------------

  /**
   * Recover a dropped connection via the shared ReconnectionManager
   * (exponential backoff + jitter + exhaustion). `scheduleReconnect` is
   * single-shot, so a failed attempt re-drives it (deferred past the manager's
   * internal active-guard) until recovery or exhaustion — same idiom as
   * irc/imessage.
   */
  private scheduleReconnect(): void {
    if (this.reconnecting || this.closing || !this.running) {
      return;
    }
    if (this.reconnectionManager.listenerCount('exhausted') === 0) {
      this.reconnectionManager.on('exhausted', () => {
        this.reconnecting = false;
        this.running = false;
        this.emit('disconnected', new Error('Nextcloud Talk reconnection failed after all retries'));
        logger.error('NextcloudTalkClient: reconnection failed permanently');
      });
    }

    this.reconnecting = true;
    this.emit('disconnected', new Error('Nextcloud Talk connection dropped'));
    this.reconnectionManager.scheduleReconnect(async () => {
      // One probe poll. Success resumes the steady-state loop; failure re-drives
      // the manager.
      try {
        await this.pollOnce();
        this.reconnecting = false;
        this.reconnectionManager.onConnected();
        this.emit('reconnected');
        this.onConnectedOnce();
        // Resume the steady-state loop.
        void this.runPollLoop();
      } catch (error) {
        if (this.isAbortError(error) || this.closing || !this.running) {
          return; // intentional teardown mid-reconnect
        }
        if (this.running && !this.closing) {
          setTimeout(() => {
            if (this.running && this.reconnecting && !this.closing) {
              this.reconnecting = false;
              this.scheduleReconnect();
            }
          }, 0).unref?.();
        }
        throw error instanceof Error ? error : new Error(String(error));
      }
    });
  }

  // --------------------------------------------------------------------------
  // Send
  // --------------------------------------------------------------------------

  async sendMessage(roomToken: string, text: string): Promise<{ success: boolean; messageId?: string }> {
    const url = `${this.baseUrl}${SPREED_CHAT_PATH}/${encodeURIComponent(roomToken)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...this.buildHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Nextcloud Talk send failed: ${response.status} ${response.statusText} - ${body}`);
    }

    const envelope = (await response.json().catch(() => ({}))) as SpreedChatEnvelope;
    const id = (envelope.ocs?.data as unknown as SpreedChatMessage | undefined)?.id;
    return { success: true, messageId: id !== undefined ? String(id) : undefined };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'OCS-APIRequest': 'true',
      Accept: 'application/json',
    };
    if (this.bearer) {
      headers.Authorization = `Bearer ${this.bearer}`;
    } else {
      const basic = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      headers.Authorization = `Basic ${basic}`;
    }
    return headers;
  }

  private isAbortError(err: unknown): boolean {
    return (
      err instanceof Error &&
      (err.name === 'AbortError' || /aborted/i.test(err.message))
    );
  }
}

export class NextcloudTalkChannel extends BaseChannel {
  private client: NextcloudTalkClient | null = null;
  private readonly ncConfig: NextcloudTalkChannelConfig;

  constructor(config: NextcloudTalkChannelConfig) {
    super('nextcloud-talk', {
      type: 'nextcloud-talk',
      enabled: config.enabled,
      token: config.token,
      webhookUrl: config.webhookUrl,
      allowedUsers: config.allowedUsers,
      allowedChannels: config.allowedChannels,
      autoReply: config.autoReply,
      rateLimit: config.rateLimit,
      options: config.options,
    });
    this.ncConfig = config;
  }

  async connect(): Promise<void> {
    const client = new NextcloudTalkClient(this.ncConfig);
    this.client = client;

    client.on('message', (message: InboundMessage) => {
      this.status.lastActivity = new Date();
      this.emit('message', message);
      if (message.isCommand) {
        this.emit('command', message);
      }
    });
    // 'connected' fires on the first successful poll — that's when we flip the
    // channel status to connected (a long-poll can hold open for ~30s, so we do
    // NOT block connect() on it).
    client.on('connected', () => {
      this.status.connected = true;
      this.status.authenticated = true;
      this.status.lastActivity = new Date();
      this.emit('connected', this.type);
    });
    client.on('reconnected', () => {
      this.status.connected = true;
      this.status.lastActivity = new Date();
    });
    client.on('disconnected', (err?: Error) => {
      this.status.connected = false;
      this.emit('disconnected', this.type, err);
    });
    client.on('error', (err: Error) => {
      this.status.error = err.message;
      this.emit('error', this.type, err);
    });

    client.start();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.stop();
      this.client.removeAllListeners();
      this.client = null;
    }
    if (!this.status.connected) return;
    this.status.connected = false;
    this.status.lastActivity = new Date();
    this.emit('disconnected', this.type);
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    if (!this.client) {
      return { success: false, error: 'Not connected', timestamp: new Date() };
    }
    const room = message.channelId || this.client.getRoomToken();
    try {
      const result = await this.client.sendMessage(room, message.content);
      this.status.lastActivity = new Date();
      return {
        success: result.success,
        messageId: result.messageId,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      };
    }
  }
}

export default NextcloudTalkAdapter;
