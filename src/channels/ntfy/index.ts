/**
 * ntfy Channel Adapter
 *
 * Publishes outbound Code Buddy messages to ntfy topics with the official
 * HTTP POST topic API.
 */

import { logger } from '../../utils/logger.js';
import { BaseChannel, ChannelConfig, DeliveryResult, OutboundMessage } from '../core.js';

export interface NtfyConfig {
  serverUrl?: string;
  token?: string;
  topic?: string;
  title?: string;
  priority?: string | number;
  tags?: string[] | string;
}

export interface NtfyChannelConfig extends ChannelConfig {
  serverUrl?: string;
  topic?: string;
  title?: string;
  priority?: string | number;
  tags?: string[] | string;
}

export interface NtfyPublishOptions {
  title?: string;
  priority?: string | number;
  tags?: string[] | string;
  sequenceId?: string;
}

export interface NtfyPublishResult {
  success: boolean;
  messageId?: string;
  status: number;
  topic: string;
}

type NtfyChannelData = Partial<NtfyPublishOptions>;

export class NtfyAdapter {
  private config: Required<Pick<NtfyConfig, 'serverUrl'>> & Omit<NtfyConfig, 'serverUrl'>;
  private running = false;

  constructor(config: NtfyConfig = {}) {
    this.config = {
      ...config,
      serverUrl: normalizeServerUrl(config.serverUrl ?? 'https://ntfy.sh'),
    };
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('NtfyAdapter is already running');
    }
    new URL(this.config.serverUrl);
    logger.debug('NtfyAdapter: ready', sanitizeServerInfo(this.config.serverUrl));
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('NtfyAdapter is not running');
    }
    logger.debug('NtfyAdapter: stopping');
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  getConfig(): NtfyConfig {
    return {
      ...this.config,
      ...(Array.isArray(this.config.tags) ? { tags: [...this.config.tags] } : {}),
    };
  }

  getServerUrl(): string {
    return this.config.serverUrl;
  }

  async publish(topic: string, message: string, options: NtfyPublishOptions = {}): Promise<NtfyPublishResult> {
    if (!this.running) {
      throw new Error('NtfyAdapter is not running');
    }

    const normalizedTopic = normalizeTopic(topic);
    const url = buildPublishUrl(this.config.serverUrl, normalizedTopic, options.sequenceId);
    const headers = buildHeaders(this.config, options);
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: message,
    });
    const body = await response.text();

    if (!response.ok) {
      throw new Error(`ntfy publish failed (${response.status}): ${extractErrorMessage(body)}`);
    }

    const payload = parseJsonObject(body);
    return {
      success: true,
      messageId: typeof payload.id === 'string' ? payload.id : undefined,
      status: response.status,
      topic: normalizedTopic,
    };
  }
}

export class NtfyChannel extends BaseChannel {
  private adapter: NtfyAdapter;
  private readonly defaultTopic?: string;
  private readonly defaultTitle?: string;
  private readonly defaultPriority?: string | number;
  private readonly defaultTags?: string[] | string;

  constructor(config: NtfyChannelConfig) {
    super('ntfy', {
      type: 'ntfy',
      enabled: config.enabled,
      token: config.token,
      webhookUrl: config.webhookUrl,
      allowedUsers: config.allowedUsers,
      allowedChannels: config.allowedChannels,
      autoReply: config.autoReply,
      rateLimit: config.rateLimit,
      options: config.options,
    });
    const serverUrl = config.serverUrl ?? config.webhookUrl;
    this.defaultTopic = config.topic;
    this.defaultTitle = config.title;
    this.defaultPriority = config.priority;
    this.defaultTags = config.tags;
    this.adapter = new NtfyAdapter({
      serverUrl,
      token: config.token,
      topic: config.topic,
      title: config.title,
      priority: config.priority,
      tags: config.tags,
    });
  }

  // REST adapter — outbound messages are one-shot HTTP POSTs to an ntfy topic;
  // there is no persistent subscription stream held open here, so reconnection
  // (ReconnectionManager) is N/A.
  async connect(): Promise<void> {
    await this.adapter.start();
    this.status.connected = true;
    this.status.authenticated = true;
    this.status.lastActivity = new Date();
    this.status.info = sanitizeServerInfo(this.adapter.getServerUrl());
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
      const channelData = extractNtfyChannelData(message);
      const result = await this.adapter.publish(
        message.channelId || this.defaultTopic || '',
        this.formatMessage(message.content, message.parseMode),
        {
          title: channelData.title ?? this.defaultTitle,
          priority: channelData.priority ?? (message.silent ? 'min' : this.defaultPriority),
          tags: channelData.tags ?? this.defaultTags,
          sequenceId: channelData.sequenceId,
        },
      );
      this.status.lastActivity = new Date();
      return {
        success: result.success,
        messageId: result.messageId,
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

function normalizeServerUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('ntfy serverUrl is required');
  }
  return trimmed;
}

function normalizeTopic(value: string): string {
  const topic = value.trim().replace(/^\/+|\/+$/g, '');
  if (!topic) {
    throw new Error('ntfy topic is required');
  }
  return topic;
}

function buildPublishUrl(serverUrl: string, topic: string, sequenceId?: string): string {
  const url = new URL(serverUrl);
  const basePath = url.pathname.replace(/\/+$/g, '');
  const segments = [
    ...basePath.split('/').filter(Boolean),
    ...topic.split('/').filter(Boolean),
    ...(sequenceId ? [sequenceId] : []),
  ];
  url.pathname = `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
  return url.toString();
}

function sanitizeServerInfo(serverUrl: string): Record<string, unknown> {
  const url = new URL(serverUrl);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return {
    serverOrigin: url.origin,
    ...(url.pathname !== '/' ? { basePath: url.pathname } : {}),
  };
}

function buildHeaders(config: NtfyConfig, options: NtfyPublishOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
  };
  if (config.token) {
    headers.Authorization = normalizeAuthorization(config.token);
  }
  const title = options.title ?? config.title;
  if (title) {
    headers.Title = title;
  }
  const priority = options.priority ?? config.priority;
  if (priority !== undefined) {
    headers.Priority = String(priority);
  }
  const tags = normalizeTags(options.tags ?? config.tags);
  if (tags) {
    headers.Tags = tags;
  }
  return headers;
}

function normalizeAuthorization(token: string): string {
  const trimmed = token.trim();
  return /^(basic|bearer)\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

function normalizeTags(tags: string[] | string | undefined): string | undefined {
  if (!tags) return undefined;
  if (Array.isArray(tags)) {
    const normalized = tags.map((tag) => tag.trim()).filter(Boolean);
    return normalized.length > 0 ? normalized.join(',') : undefined;
  }
  const normalized = tags.trim();
  return normalized || undefined;
}

function extractNtfyChannelData(message: OutboundMessage): NtfyChannelData {
  const raw = message.channelData?.ntfy;
  if (!isRecord(raw)) return {};
  return {
    title: typeof raw.title === 'string' ? raw.title : undefined,
    priority: typeof raw.priority === 'string' || typeof raw.priority === 'number' ? raw.priority : undefined,
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((tag): tag is string => typeof tag === 'string')
      : typeof raw.tags === 'string'
        ? raw.tags
        : undefined,
    sequenceId: typeof raw.sequenceId === 'string' ? raw.sequenceId : undefined,
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

function extractErrorMessage(text: string): string {
  const payload = parseJsonObject(text);
  if (typeof payload.error === 'string') return payload.error;
  if (typeof payload.message === 'string') return payload.message;
  return text.trim() || 'empty response';
}

export default NtfyAdapter;
