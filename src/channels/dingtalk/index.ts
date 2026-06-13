/**
 * DingTalk Channel Adapter
 *
 * Publishes outbound Code Buddy messages to DingTalk custom robot webhooks.
 */

import { createHmac } from 'crypto';

import { logger } from '../../utils/logger.js';
import { BaseChannel, ChannelConfig, DeliveryResult, OutboundMessage } from '../core.js';

export type DingTalkMessageType = 'text' | 'markdown';

export interface DingTalkConfig {
  webhookUrl?: string;
  accessToken?: string;
  secret?: string;
  msgType?: DingTalkMessageType;
  title?: string;
  atMobiles?: string[];
  atUserIds?: string[];
  isAtAll?: boolean;
}

export interface DingTalkChannelConfig extends ChannelConfig {
  accessToken?: string;
  secret?: string;
  msgType?: DingTalkMessageType;
  title?: string;
  atMobiles?: string[];
  atUserIds?: string[];
  isAtAll?: boolean;
}

export interface DingTalkSendOptions {
  msgType?: DingTalkMessageType;
  title?: string;
  atMobiles?: string[];
  atUserIds?: string[];
  isAtAll?: boolean;
}

export interface DingTalkSendResult {
  errcode?: number;
  errmsg?: string;
  success: boolean;
  status: number;
}

interface DingTalkPayload {
  at?: {
    atMobiles?: string[];
    atUserIds?: string[];
    isAtAll?: boolean;
  };
  markdown?: {
    text: string;
    title: string;
  };
  msgtype: DingTalkMessageType;
  text?: {
    content: string;
  };
}

type DingTalkChannelData = Partial<DingTalkSendOptions>;

export class DingTalkAdapter {
  private readonly config: Required<Pick<DingTalkConfig, 'webhookUrl'>> & Omit<DingTalkConfig, 'webhookUrl'>;
  private readonly now: () => number;
  private running = false;

  constructor(config: DingTalkConfig = {}, options: { now?: () => number } = {}) {
    this.config = {
      ...config,
      webhookUrl: resolveWebhookUrl(config),
    };
    this.now = options.now ?? Date.now;
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('DingTalkAdapter is already running');
    }
    new URL(this.config.webhookUrl);
    logger.debug('DingTalkAdapter: ready', sanitizeWebhookInfo(this.config.webhookUrl, Boolean(this.config.secret)));
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('DingTalkAdapter is not running');
    }
    logger.debug('DingTalkAdapter: stopping');
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  getWebhookInfo(): Record<string, unknown> {
    return sanitizeWebhookInfo(this.config.webhookUrl, Boolean(this.config.secret));
  }

  getConfig(): DingTalkConfig {
    return {
      ...this.config,
      ...(this.config.atMobiles ? { atMobiles: [...this.config.atMobiles] } : {}),
      ...(this.config.atUserIds ? { atUserIds: [...this.config.atUserIds] } : {}),
    };
  }

  async send(content: string, options: DingTalkSendOptions = {}): Promise<DingTalkSendResult> {
    if (!this.running) {
      throw new Error('DingTalkAdapter is not running');
    }

    const payload = buildPayload(content, this.config, options);
    const response = await fetch(buildWebhookUrl(this.config.webhookUrl, this.config.secret, this.now()), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const responseText = await response.text();
    const body = parseJsonObject(responseText);
    const errcode = typeof body.errcode === 'number' ? body.errcode : undefined;
    const errmsg = typeof body.errmsg === 'string' ? body.errmsg : undefined;

    if (!response.ok || (errcode !== undefined && errcode !== 0)) {
      const errorMessage = errmsg ?? (responseText.trim() || 'empty response');
      throw new Error(`DingTalk send failed (${response.status}${errcode !== undefined ? `/${errcode}` : ''}): ${errorMessage}`);
    }

    return {
      errcode,
      errmsg,
      success: true,
      status: response.status,
    };
  }
}

export class DingTalkChannel extends BaseChannel {
  private adapter: DingTalkAdapter;
  private readonly defaultMsgType?: DingTalkMessageType;
  private readonly defaultTitle?: string;
  private readonly defaultAtMobiles?: string[];
  private readonly defaultAtUserIds?: string[];
  private readonly defaultIsAtAll?: boolean;

  constructor(config: DingTalkChannelConfig, options: { now?: () => number } = {}) {
    super('dingtalk', {
      type: 'dingtalk',
      enabled: config.enabled,
      token: config.token,
      webhookUrl: config.webhookUrl,
      allowedUsers: config.allowedUsers,
      allowedChannels: config.allowedChannels,
      autoReply: config.autoReply,
      rateLimit: config.rateLimit,
      options: config.options,
    });
    this.defaultMsgType = config.msgType;
    this.defaultTitle = config.title;
    this.defaultAtMobiles = config.atMobiles;
    this.defaultAtUserIds = config.atUserIds;
    this.defaultIsAtAll = config.isAtAll;
    this.adapter = new DingTalkAdapter({
      webhookUrl: config.webhookUrl,
      accessToken: config.accessToken ?? config.token,
      secret: config.secret,
      msgType: config.msgType,
      title: config.title,
      atMobiles: config.atMobiles,
      atUserIds: config.atUserIds,
      isAtAll: config.isAtAll,
    }, options);
  }

  // REST/webhook adapter — outbound messages are one-shot HTTPS POSTs to the
  // DingTalk robot webhook; there is no persistent connection, so reconnection
  // (ReconnectionManager) is N/A.
  async connect(): Promise<void> {
    await this.adapter.start();
    this.status.connected = true;
    this.status.authenticated = true;
    this.status.lastActivity = new Date();
    this.status.info = this.adapter.getWebhookInfo();
    this.emit('connected', this.type);
  }

  async disconnect(): Promise<void> {
    if (!this.status.connected) return;
    await this.adapter.stop();
    this.status.connected = false;
    this.status.authenticated = false;
    this.status.lastActivity = new Date();
    this.emit('disconnected', this.type);
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    try {
      const channelData = extractDingTalkChannelData(message);
      const result = await this.adapter.send(this.formatMessage(message.content, message.parseMode), {
        msgType: channelData.msgType ?? this.defaultMsgType,
        title: channelData.title ?? this.defaultTitle,
        atMobiles: channelData.atMobiles ?? this.defaultAtMobiles,
        atUserIds: channelData.atUserIds ?? this.defaultAtUserIds,
        isAtAll: channelData.isAtAll ?? this.defaultIsAtAll,
      });
      this.status.lastActivity = new Date();
      return {
        success: result.success,
        messageId: result.errmsg,
        timestamp: new Date(),
      };
    } catch (error) {
      this.status.error = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: this.status.error,
        timestamp: new Date(),
      };
    }
  }
}

function resolveWebhookUrl(config: DingTalkConfig): string {
  const explicit = config.webhookUrl?.trim();
  if (explicit) return explicit;
  const accessToken = config.accessToken?.trim();
  if (accessToken) {
    const url = new URL('https://oapi.dingtalk.com/robot/send');
    url.searchParams.set('access_token', accessToken);
    return url.toString();
  }
  throw new Error('DingTalk webhookUrl or accessToken is required');
}

function buildWebhookUrl(webhookUrl: string, secret: string | undefined, timestamp: number): string {
  const url = new URL(webhookUrl);
  if (secret) {
    const timestampText = String(timestamp);
    url.searchParams.set('timestamp', timestampText);
    url.searchParams.set('sign', signDingTalkRequest(timestampText, secret));
  }
  return url.toString();
}

function signDingTalkRequest(timestamp: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}\n${secret}`)
    .digest('base64');
}

function buildPayload(content: string, config: DingTalkConfig, options: DingTalkSendOptions): DingTalkPayload {
  const msgtype = options.msgType ?? config.msgType ?? 'text';
  const at = buildAt(config, options);
  if (msgtype === 'markdown') {
    return {
      msgtype,
      markdown: {
        title: options.title ?? config.title ?? 'Code Buddy',
        text: content,
      },
      ...(at ? { at } : {}),
    };
  }
  return {
    msgtype: 'text',
    text: {
      content,
    },
    ...(at ? { at } : {}),
  };
}

function buildAt(config: DingTalkConfig, options: DingTalkSendOptions): DingTalkPayload['at'] | undefined {
  const atMobiles = options.atMobiles ?? config.atMobiles;
  const atUserIds = options.atUserIds ?? config.atUserIds;
  const isAtAll = options.isAtAll ?? config.isAtAll;
  if (!atMobiles?.length && !atUserIds?.length && isAtAll === undefined) {
    return undefined;
  }
  return {
    ...(atMobiles?.length ? { atMobiles } : {}),
    ...(atUserIds?.length ? { atUserIds } : {}),
    ...(isAtAll !== undefined ? { isAtAll } : {}),
  };
}

function extractDingTalkChannelData(message: OutboundMessage): DingTalkChannelData {
  const raw = message.channelData?.dingtalk;
  if (!isRecord(raw)) return {};
  return {
    msgType: raw.msgType === 'markdown' || raw.msgType === 'text' ? raw.msgType : undefined,
    title: typeof raw.title === 'string' ? raw.title : undefined,
    atMobiles: Array.isArray(raw.atMobiles)
      ? raw.atMobiles.filter((value): value is string => typeof value === 'string')
      : undefined,
    atUserIds: Array.isArray(raw.atUserIds)
      ? raw.atUserIds.filter((value): value is string => typeof value === 'string')
      : undefined,
    isAtAll: typeof raw.isAtAll === 'boolean' ? raw.isAtAll : undefined,
  };
}

function sanitizeWebhookInfo(webhookUrl: string, signed: boolean): Record<string, unknown> {
  const url = new URL(webhookUrl);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return {
    webhookOrigin: url.origin,
    webhookPath: url.pathname,
    signed,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export default DingTalkAdapter;
