/**
 * Slack Channel
 *
 * Slack bot implementation for the Cowork remote gateway. Primary path is
 * Socket Mode (app-level token, no public URL needed); Events API webhooks are
 * also supported via handleWebhook() when a signing secret is configured.
 *
 * Logic ported from the core channel (src/channels/slack/client.ts), adapted to
 * the Cowork ChannelBase contract (RemoteMessage / RemoteResponse).
 */

import * as crypto from 'crypto';
import WebSocket from 'ws';
import { ChannelBase, withRetry } from '../channel-base';
import { log, logError, logWarn } from '../../../utils/logger';
import type { SlackChannelConfig, RemoteMessage, RemoteResponse } from '../../types';

const SLACK_API_BASE = 'https://slack.com/api';
const PING_INTERVAL_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 10;

interface SlackEvent {
  type: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  app_id?: string;
  text?: string;
  channel?: string;
  channel_type?: string; // 'im' | 'channel' | 'group' | 'mpim'
  ts?: string;
  thread_ts?: string;
}

export class SlackChannel extends ChannelBase {
  readonly type = 'slack' as const;

  private config: SlackChannelConfig;
  private ws: WebSocket | null = null;
  private botUserId?: string;
  private botName?: string;
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private reconnecting = false;
  private stopping = false;

  constructor(config: SlackChannelConfig) {
    super();
    this.config = config;
    if (!config.botToken) {
      throw new Error('Slack bot token (botToken) is required');
    }
  }

  private get useSocketMode(): boolean {
    return this.config.useSocketMode !== false && !!this.config.appToken;
  }

  /**
   * Slack Web API request (https://slack.com/api/<method>).
   */
  private async apiRequest<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch(`${SLACK_API_BASE}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: params ? JSON.stringify(params) : undefined,
    });
    const data = (await response.json()) as { ok: boolean; error?: string } & T;
    if (!data.ok) {
      throw new Error(`Slack API error (${method}): ${data.error || 'unknown'}`);
    }
    return data;
  }

  /**
   * Start the channel
   */
  async start(): Promise<void> {
    if (this._connected) {
      logWarn('[Slack] Channel already started');
      return;
    }
    this.stopping = false;
    this.logStatus('Starting channel...');

    try {
      // Verify the bot token and capture the bot's own user id (to skip its messages).
      const auth = await this.apiRequest<{ user_id: string; user: string; team: string }>(
        'auth.test'
      );
      this.botUserId = auth.user_id;
      this.botName = auth.user;
      log('[Slack] Bot info:', { userId: this.botUserId, name: this.botName, team: auth.team });

      if (this.useSocketMode) {
        await this.connectSocketMode();
      } else {
        this.logStatus('Using webhook mode - waiting for incoming Events API requests');
      }

      this._connected = true;
      this.logStatus('Channel started successfully');
    } catch (error) {
      logError('[Slack] Failed to start channel:', error);
      this._connected = false;
      throw error;
    }
  }

  /**
   * Stop the channel
   */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this._connected = false;
    this.logStatus('Channel stopped');
  }

  // ===========================================================================
  // Socket Mode
  // ===========================================================================

  private async connectSocketMode(): Promise<void> {
    const url = await this.getSocketUrl();
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.on('open', () => {
        this.reconnectAttempts = 0;
        // Mark connected here so it is restored after a reconnect too — not just
        // on the initial start() (otherwise send() throws after the first socket
        // recycle and the bot silently stops replying).
        this._connected = true;
        this.pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.ping();
        }, PING_INTERVAL_MS);
        log('[Slack] Socket Mode connected');
        resolve();
      });

      ws.on('message', (data) => {
        try {
          this.handleSocketMessage(JSON.parse(data.toString()));
        } catch (error) {
          logError('[Slack] Failed to handle socket message:', error);
        }
      });

      ws.on('close', () => this.handleClose());

      ws.on('error', (error) => {
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
        this.emitError(error instanceof Error ? error : new Error(String(error)));
        if (!this._connected) reject(error);
      });
    });
  }

  private async getSocketUrl(): Promise<string> {
    const response = await fetch(`${SLACK_API_BASE}/apps.connections.open`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.appToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    const data = (await response.json()) as { ok: boolean; url?: string; error?: string };
    if (!data.ok || !data.url) {
      throw new Error(`Failed to open Socket Mode connection: ${data.error || 'unknown'}`);
    }
    return data.url;
  }

  private handleSocketMessage(payload: {
    type: string;
    envelope_id?: string;
    payload?: { event?: SlackEvent };
  }): void {
    // Acknowledge envelopes immediately (Slack requires ack within 3s).
    if (payload.envelope_id && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ envelope_id: payload.envelope_id }));
    }

    if (payload.type === 'events_api' && payload.payload?.event) {
      this.handleEvent(payload.payload.event);
    } else if (payload.type === 'disconnect') {
      this.handleClose();
    }
  }

  private handleClose(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this._connected = false;
    if (this.stopping || !this.useSocketMode) {
      return;
    }
    // Guard against duplicate close signals (e.g. a 'disconnect' frame followed
    // by the socket 'close' event) spawning parallel reconnect loops.
    if (this.reconnecting) {
      return;
    }
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logError('[Slack] Max reconnect attempts reached, giving up');
      return;
    }
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 60_000);
    this.reconnectAttempts += 1;
    this.reconnecting = true;
    logWarn(`[Slack] Socket closed, reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => {
      if (this.stopping) {
        this.reconnecting = false;
        return;
      }
      this.connectSocketMode()
        .then(() => {
          this.reconnecting = false;
        })
        .catch((err) => {
          this.reconnecting = false;
          logError('[Slack] Reconnect failed:', err);
          this.handleClose();
        });
    }, delay);
  }

  // ===========================================================================
  // Webhook (Events API) — parity with Feishu.handleWebhook
  // ===========================================================================

  /**
   * Verify the Slack request signature (X-Slack-Signature / v0 scheme).
   */
  private verifySignature(body: string, signature: string, timestamp: string): boolean {
    const secret = this.config.signingSecret;
    if (!secret) return false;
    // Reject requests older than 5 minutes (replay protection).
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 * 5) return false;
    const base = `v0:${timestamp}:${body}`;
    const expected = 'v0=' + crypto.createHmac('sha256', secret).update(base).digest('hex');
    try {
      const a = Buffer.from(expected);
      const b = Buffer.from(signature);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  async handleWebhook(
    headers: Record<string, string>,
    body: string
  ): Promise<{ status: number; data: Record<string, unknown> }> {
    log('[Slack] Received webhook request');
    let data: { type?: string; challenge?: string; event?: SlackEvent };
    try {
      data = JSON.parse(body);
    } catch {
      return { status: 400, data: { error: 'Invalid JSON' } };
    }

    // URL verification challenge does not require signature.
    if (data.type === 'url_verification') {
      return { status: 200, data: { challenge: data.challenge } };
    }

    const signature = headers['x-slack-signature'];
    const timestamp = headers['x-slack-request-timestamp'] || '';
    if (!signature) {
      logWarn('[Slack] Webhook rejected: missing X-Slack-Signature');
      return { status: 403, data: { error: 'Missing signature' } };
    }
    if (!this.verifySignature(body, signature, timestamp)) {
      logWarn('[Slack] Webhook signature verification failed');
      return { status: 403, data: { error: 'Invalid signature' } };
    }

    if (data.type === 'event_callback' && data.event) {
      this.handleEvent(data.event);
    }
    return { status: 200, data: { ok: true } };
  }

  // ===========================================================================
  // Event → RemoteMessage
  // ===========================================================================

  private handleEvent(event: SlackEvent): void {
    try {
      // Ignore the bot's own and other bots' messages.
      if (event.bot_id || event.app_id) return;
      if (event.user && event.user === this.botUserId) return;

      const isMessage = event.type === 'message' && !event.subtype;
      const isMention = event.type === 'app_mention';
      if (!isMessage && !isMention) return;
      if (!event.text || !event.channel) return;

      const cleanedText = this.stripBotMention(event.text);
      const channelType = event.channel_type;
      const isGroup = channelType === 'channel' || channelType === 'group' || channelType === 'mpim';

      const remoteMessage: RemoteMessage = {
        id: event.ts || String(Date.now()),
        channelType: 'slack',
        channelId: event.channel,
        sender: {
          id: event.user || 'unknown',
          isBot: false,
        },
        content: { type: 'text', text: cleanedText },
        replyTo: event.thread_ts,
        timestamp: event.ts ? Math.floor(Number(event.ts) * 1000) : Date.now(),
        isGroup,
        isMentioned: isMention || (!!this.botUserId && event.text.includes(`<@${this.botUserId}>`)),
        raw: event,
      };

      this.emitMessage(remoteMessage);
    } catch (error) {
      logError('[Slack] Error handling event:', error);
    }
  }

  /** Remove the bot's own <@BOTID> mention placeholder from text. */
  private stripBotMention(text: string): string {
    if (!this.botUserId) return text.trim();
    return text.replace(new RegExp(`<@${this.botUserId}>`, 'g'), '').trim();
  }

  /**
   * Convert the most common standard-Markdown constructs to Slack mrkdwn so the
   * agent's replies don't render with literal `**`, `#` and `[](...)`. This is a
   * pragmatic subset (bold, links, headers); code blocks and lists already
   * render acceptably in Slack and are left untouched.
   */
  private markdownToMrkdwn(md: string): string {
    return (
      md
        // [text](url) -> <url|text>
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<$2|$1>')
        // **bold** / __bold__ -> *bold*
        .replace(/\*\*([^*]+)\*\*/g, '*$1*')
        .replace(/__([^_]+)__/g, '*$1*')
        // # Heading -> *Heading* (Slack has no headers)
        .replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, '*$1*')
    );
  }

  // ===========================================================================
  // Send
  // ===========================================================================

  async send(response: RemoteResponse): Promise<void> {
    if (!this._connected) {
      throw new Error('Channel not connected');
    }
    const { channelId, content, replyTo } = response;

    // Slack renders mrkdwn in the `text` field; convert standard Markdown replies.
    const text =
      content.type === 'markdown'
        ? this.markdownToMrkdwn(content.markdown ?? '')
        : content.text ?? '';
    const blocks =
      content.type === 'card' && Array.isArray(content.card) ? (content.card as unknown[]) : undefined;

    log('[Slack] Sending message:', { channelId, contentType: content.type, hasReplyTo: !!replyTo });

    await withRetry(
      async () => {
        // Slack hard-limits a single message's text to ~40k chars; split well below that.
        const chunks = text ? this.splitMessage(text, 3500) : [''];
        for (let i = 0; i < chunks.length; i++) {
          const params: Record<string, unknown> = {
            channel: channelId,
            text: chunks[i],
          };
          if (replyTo) params.thread_ts = replyTo;
          // Attach blocks only on the first chunk.
          if (blocks && i === 0) params.blocks = blocks;
          await this.apiRequest('chat.postMessage', params);
          if (chunks.length > 1) await new Promise((r) => setTimeout(r, 200));
        }
      },
      {
        maxRetries: 3,
        delayMs: 1000,
        onRetry: (attempt, error) => logWarn(`[Slack] Send retry ${attempt}:`, error.message),
      }
    );

    log('[Slack] Message sent successfully');
  }
}
