/**
 * Weixin Official Account Channel Adapter
 *
 * Publishes outbound Code Buddy messages through the Weixin/WeChat Official
 * Account customer-service message API.
 */

import { logger } from '../../utils/logger.js';
import { BaseChannel, ChannelConfig, DeliveryResult, OutboundMessage } from '../core.js';

export interface WeixinConfig {
  accessToken?: string;
  apiBaseUrl?: string;
  webhookUrl?: string;
  kfAccount?: string;
}

export interface WeixinChannelConfig extends ChannelConfig {
  accessToken?: string;
  apiBaseUrl?: string;
  kfAccount?: string;
}

export interface WeixinSendOptions {
  kfAccount?: string;
}

export interface WeixinSendResult {
  errcode?: number;
  errmsg?: string;
  success: boolean;
  status: number;
}

interface WeixinPayload {
  customservice?: {
    kf_account: string;
  };
  msgtype: 'text';
  text: {
    content: string;
  };
  touser: string;
}

type WeixinChannelData = Partial<WeixinSendOptions>;

export class WeixinAdapter {
  private readonly config: Required<Pick<WeixinConfig, 'webhookUrl'>> & Omit<WeixinConfig, 'webhookUrl'>;
  private running = false;

  constructor(config: WeixinConfig = {}) {
    this.config = {
      ...config,
      webhookUrl: resolveWebhookUrl(config),
    };
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('WeixinAdapter is already running');
    }
    new URL(this.config.webhookUrl);
    logger.debug('WeixinAdapter: ready', sanitizeWebhookInfo(this.config.webhookUrl, Boolean(this.config.kfAccount)));
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('WeixinAdapter is not running');
    }
    logger.debug('WeixinAdapter: stopping');
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  getWebhookInfo(): Record<string, unknown> {
    return sanitizeWebhookInfo(this.config.webhookUrl, Boolean(this.config.kfAccount));
  }

  getConfig(): WeixinConfig {
    return { ...this.config };
  }

  async sendText(openId: string, content: string, options: WeixinSendOptions = {}): Promise<WeixinSendResult> {
    if (!this.running) {
      throw new Error('WeixinAdapter is not running');
    }
    const recipient = openId.trim();
    if (!recipient) {
      throw new Error('Weixin openId is required');
    }

    const response = await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildPayload(recipient, content, options.kfAccount ?? this.config.kfAccount)),
    });
    const responseText = await response.text();
    const body = parseJsonObject(responseText);
    const errcode = typeof body.errcode === 'number' ? body.errcode : undefined;
    const errmsg = typeof body.errmsg === 'string' ? body.errmsg : undefined;

    if (!response.ok || (errcode !== undefined && errcode !== 0)) {
      const errorMessage = errmsg ?? (responseText.trim() || 'empty response');
      throw new Error(`Weixin send failed (${response.status}${errcode !== undefined ? `/${errcode}` : ''}): ${errorMessage}`);
    }

    return {
      errcode,
      errmsg,
      success: true,
      status: response.status,
    };
  }
}

export class WeixinChannel extends BaseChannel {
  private adapter: WeixinAdapter;
  private readonly defaultKfAccount?: string;

  constructor(config: WeixinChannelConfig) {
    super('weixin', {
      type: 'weixin',
      enabled: config.enabled,
      token: config.token,
      webhookUrl: config.webhookUrl,
      allowedUsers: config.allowedUsers,
      allowedChannels: config.allowedChannels,
      autoReply: config.autoReply,
      rateLimit: config.rateLimit,
      options: config.options,
    });
    this.defaultKfAccount = config.kfAccount;
    this.adapter = new WeixinAdapter({
      webhookUrl: config.webhookUrl,
      apiBaseUrl: config.apiBaseUrl,
      accessToken: config.accessToken ?? config.token,
      kfAccount: config.kfAccount,
    });
  }

  // REST/webhook adapter — outbound via the WeChat (Weixin) HTTP API, inbound
  // via webhook callbacks; no persistent connection is held open, so
  // reconnection (ReconnectionManager) is N/A.
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
      const channelData = extractWeixinChannelData(message);
      const result = await this.adapter.sendText(
        message.channelId,
        this.formatMessage(message.content, message.parseMode),
        { kfAccount: channelData.kfAccount ?? this.defaultKfAccount },
      );
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

function resolveWebhookUrl(config: WeixinConfig): string {
  const explicit = config.webhookUrl?.trim();
  if (explicit) return explicit;

  const accessToken = config.accessToken?.trim();
  if (!accessToken) {
    throw new Error('Weixin webhookUrl or accessToken is required');
  }
  const baseUrl = new URL(config.apiBaseUrl ?? 'https://api.weixin.qq.com');
  const basePath = baseUrl.pathname.replace(/\/+$/g, '');
  baseUrl.pathname = `${basePath}/cgi-bin/message/custom/send`;
  baseUrl.searchParams.set('access_token', accessToken);
  return baseUrl.toString();
}

function buildPayload(openId: string, content: string, kfAccount: string | undefined): WeixinPayload {
  return {
    touser: openId,
    msgtype: 'text',
    text: {
      content,
    },
    ...(kfAccount ? { customservice: { kf_account: kfAccount } } : {}),
  };
}

function extractWeixinChannelData(message: OutboundMessage): WeixinChannelData {
  const raw = message.channelData?.weixin;
  if (!isRecord(raw)) return {};
  return {
    kfAccount: typeof raw.kfAccount === 'string' ? raw.kfAccount : undefined,
  };
}

function sanitizeWebhookInfo(webhookUrl: string, hasCustomService: boolean): Record<string, unknown> {
  const url = new URL(webhookUrl);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return {
    apiOrigin: url.origin,
    apiPath: url.pathname,
    hasCustomService,
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

export default WeixinAdapter;
