import { mkdir, readFile, writeFile } from 'fs/promises';
import * as path from 'path';
import type { ChannelType, ContentType } from '../channels/core.js';
import { recordCompanionPercept, type CompanionPercept } from './percepts.js';
import { recordCompanionSafetyEvent, type CompanionSafetyEvent } from './safety-ledger.js';
import {
  recordCompanionGatewayInboxItem,
  type CompanionGatewayInboxItem,
} from './gateway-inbox.js';

export type CompanionGatewayMode = 'observe' | 'assist' | 'act';

export interface CompanionGatewayChannelConfig {
  channel: ChannelType;
  enabled: boolean;
  mode: CompanionGatewayMode;
  allowOutbound: boolean;
  requireApprovalForTools: boolean;
  recordPercepts: boolean;
  tags: string[];
}

export interface CompanionGatewayProfile {
  schemaVersion: 1;
  cwd: string;
  storePath: string;
  updatedAt: string;
  defaultMode: CompanionGatewayMode;
  channels: CompanionGatewayChannelConfig[];
}

export interface CompanionGatewayOptions {
  cwd?: string;
  now?: Date;
  storePath?: string;
}

export interface CompanionGatewayUpdateOptions extends CompanionGatewayOptions {
  mode?: CompanionGatewayMode;
  allowOutbound?: boolean;
  requireApprovalForTools?: boolean;
  recordPercepts?: boolean;
  enabled?: boolean;
  tags?: string[];
}

export interface CompanionGatewayMessageInput {
  channel: ChannelType;
  text: string;
  senderId: string;
  senderName?: string;
  threadId?: string;
  messageId?: string;
  contentType?: ContentType;
  attachmentCount?: number;
}

export interface CompanionGatewayMessageResult {
  accepted: boolean;
  reason: string;
  sessionKey: string;
  channel: CompanionGatewayChannelConfig;
  inboxItem?: CompanionGatewayInboxItem;
  percept?: CompanionPercept;
  safetyEvent?: CompanionSafetyEvent;
}

const DEFAULT_CHANNELS: ChannelType[] = [
  'telegram',
  'discord',
  'signal',
  'whatsapp',
  'slack',
  'webchat',
  'gmail',
  'cli',
];

function resolveCwd(cwd?: string): string {
  return cwd || process.cwd();
}

export function getCompanionGatewayProfilePath(cwd = process.cwd()): string {
  return path.join(cwd, '.codebuddy', 'companion', 'gateway-profile.json');
}

function resolveStorePath(options: CompanionGatewayOptions = {}): string {
  const cwd = resolveCwd(options.cwd);
  return path.resolve(cwd, options.storePath || getCompanionGatewayProfilePath(cwd));
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  return [...new Set(tags.map(tag => tag.trim().toLowerCase()).filter(Boolean))];
}

function isMode(value: unknown): value is CompanionGatewayMode {
  return value === 'observe' || value === 'assist' || value === 'act';
}

function defaultChannel(channel: ChannelType, defaultMode: CompanionGatewayMode): CompanionGatewayChannelConfig {
  return {
    channel,
    enabled: false,
    mode: defaultMode,
    allowOutbound: false,
    requireApprovalForTools: true,
    recordPercepts: true,
    tags: ['gateway', channel],
  };
}

function emptyProfile(options: CompanionGatewayOptions = {}): CompanionGatewayProfile {
  const cwd = resolveCwd(options.cwd);
  const defaultMode: CompanionGatewayMode = 'observe';
  return {
    schemaVersion: 1,
    cwd,
    storePath: resolveStorePath(options),
    updatedAt: (options.now || new Date()).toISOString(),
    defaultMode,
    channels: DEFAULT_CHANNELS.map(channel => defaultChannel(channel, defaultMode)),
  };
}

function parseChannel(value: unknown, defaultMode: CompanionGatewayMode): CompanionGatewayChannelConfig | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<CompanionGatewayChannelConfig>;
  if (typeof raw.channel !== 'string') return null;
  return {
    channel: raw.channel as ChannelType,
    enabled: Boolean(raw.enabled),
    mode: isMode(raw.mode) ? raw.mode : defaultMode,
    allowOutbound: Boolean(raw.allowOutbound),
    requireApprovalForTools: raw.requireApprovalForTools !== false,
    recordPercepts: raw.recordPercepts !== false,
    tags: normalizeTags(raw.tags),
  };
}

function sortChannels(channels: CompanionGatewayChannelConfig[]): CompanionGatewayChannelConfig[] {
  return [...channels].sort((a, b) => a.channel.localeCompare(b.channel));
}

async function writeProfile(profile: CompanionGatewayProfile): Promise<void> {
  await mkdir(path.dirname(profile.storePath), { recursive: true });
  await writeFile(profile.storePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
}

export async function readCompanionGatewayProfile(
  options: CompanionGatewayOptions = {},
): Promise<CompanionGatewayProfile> {
  const fallback = emptyProfile(options);
  let raw: string;
  try {
    raw = await readFile(fallback.storePath, 'utf8');
  } catch {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CompanionGatewayProfile>;
    const defaultMode = isMode(parsed.defaultMode) ? parsed.defaultMode : fallback.defaultMode;
    const parsedChannels = Array.isArray(parsed.channels)
      ? parsed.channels.map(item => parseChannel(item, defaultMode)).filter((item): item is CompanionGatewayChannelConfig => Boolean(item))
      : [];
    const byChannel = new Map<string, CompanionGatewayChannelConfig>();
    for (const channel of fallback.channels) byChannel.set(channel.channel, channel);
    for (const channel of parsedChannels) byChannel.set(channel.channel, channel);
    return {
      schemaVersion: 1,
      cwd: typeof parsed.cwd === 'string' ? parsed.cwd : fallback.cwd,
      storePath: fallback.storePath,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : fallback.updatedAt,
      defaultMode,
      channels: sortChannels([...byChannel.values()]),
    };
  } catch {
    return fallback;
  }
}

export async function updateCompanionGatewayChannel(
  channel: ChannelType,
  options: CompanionGatewayUpdateOptions = {},
): Promise<CompanionGatewayProfile> {
  const now = options.now || new Date();
  const profile = await readCompanionGatewayProfile(options);
  const existing = profile.channels.find(item => item.channel === channel) || defaultChannel(channel, profile.defaultMode);
  const updated: CompanionGatewayChannelConfig = {
    ...existing,
    enabled: options.enabled ?? existing.enabled,
    mode: options.mode ?? existing.mode,
    allowOutbound: options.allowOutbound ?? existing.allowOutbound,
    requireApprovalForTools: options.requireApprovalForTools ?? existing.requireApprovalForTools,
    recordPercepts: options.recordPercepts ?? existing.recordPercepts,
    tags: options.tags ? normalizeTags(['gateway', channel, ...options.tags]) : existing.tags,
  };
  const without = profile.channels.filter(item => item.channel !== channel);
  const next: CompanionGatewayProfile = {
    ...profile,
    updatedAt: now.toISOString(),
    channels: sortChannels([...without, updated]),
  };
  await writeProfile(next);
  return next;
}

function channelConfig(profile: CompanionGatewayProfile, channel: ChannelType): CompanionGatewayChannelConfig {
  return profile.channels.find(item => item.channel === channel) || defaultChannel(channel, profile.defaultMode);
}

function sessionKey(input: CompanionGatewayMessageInput): string {
  const thread = input.threadId || input.senderId || 'unknown';
  return `companion:${input.channel}:${thread}`;
}

function compactText(text: string, max = 2000): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 15)}... [truncated]`;
}

function summaryForMessage(input: CompanionGatewayMessageInput): string {
  const sender = input.senderName || input.senderId;
  const preview = compactText(input.text, 180);
  return `${input.channel} message from ${sender}: ${preview || '[empty message]'}`;
}

function modalityForContent(contentType: ContentType | undefined): 'hearing' | 'vision' | 'memory' {
  if (contentType === 'image' || contentType === 'video') return 'vision';
  if (contentType === 'audio' || contentType === 'voice') return 'hearing';
  return 'hearing';
}

export async function recordCompanionGatewayMessage(
  input: CompanionGatewayMessageInput,
  options: CompanionGatewayOptions = {},
): Promise<CompanionGatewayMessageResult> {
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const profile = await readCompanionGatewayProfile({ ...options, cwd, now });
  const channel = channelConfig(profile, input.channel);
  const key = sessionKey(input);
  const basePayload = {
    channel: input.channel,
    senderId: input.senderId,
    senderName: input.senderName,
    threadId: input.threadId,
    messageId: input.messageId,
    contentType: input.contentType || 'text',
    attachmentCount: input.attachmentCount || 0,
    mode: channel.mode,
    sessionKey: key,
  };

  if (!channel.enabled) {
    const safetyEvent = await recordCompanionSafetyEvent({
      kind: 'data',
      risk: 'low',
      action: 'companion_gateway_ingest_denied',
      reason: `Ignored ${input.channel} companion gateway message because the channel is disabled.`,
      status: 'denied',
      source: 'companion_gateway',
      payload: basePayload,
      tags: ['gateway', input.channel, 'disabled'],
    }, { cwd, now });
    const reason = `${input.channel} companion gateway is disabled.`;
    const inboxItem = await recordCompanionGatewayInboxItem({
      ...input,
      accepted: false,
      mode: channel.mode,
      reason,
      sessionKey: key,
      tags: ['disabled'],
    }, { cwd, now });
    return {
      accepted: false,
      reason,
      sessionKey: key,
      channel,
      inboxItem,
      safetyEvent,
    };
  }

  const percept = channel.recordPercepts
    ? await recordCompanionPercept({
        modality: modalityForContent(input.contentType),
        source: `companion_gateway:${input.channel}`,
        summary: summaryForMessage(input),
        confidence: 0.82,
        payload: {
          ...basePayload,
          text: compactText(input.text),
        },
        tags: normalizeTags([...channel.tags, channel.mode, input.contentType || 'text']),
      }, { cwd, now })
    : undefined;

  const safetyEvent = await recordCompanionSafetyEvent({
    kind: 'data',
    risk: channel.mode === 'act' ? 'medium' : 'low',
    action: 'companion_gateway_ingest',
    reason: `Accepted ${input.channel} message into companion ${channel.mode} mode.`,
    status: 'completed',
    source: 'companion_gateway',
    payload: {
      ...basePayload,
      perceptId: percept?.id,
      allowOutbound: channel.allowOutbound,
      requireApprovalForTools: channel.requireApprovalForTools,
    },
    tags: normalizeTags([...channel.tags, channel.mode, 'ingest']),
  }, { cwd, now });
  const reason = `Accepted ${input.channel} message into companion ${channel.mode} mode.`;
  const inboxItem = await recordCompanionGatewayInboxItem({
    ...input,
    accepted: true,
    mode: channel.mode,
    reason,
    sessionKey: key,
    tags: channel.tags,
  }, { cwd, now });

  return {
    accepted: true,
    reason,
    sessionKey: key,
    channel,
    inboxItem,
    percept,
    safetyEvent,
  };
}

export function formatCompanionGatewayProfile(profile: CompanionGatewayProfile): string {
  const lines = [
    'Buddy Companion Gateway Profile',
    '='.repeat(50),
    '',
    `Workspace: ${profile.cwd}`,
    `Path: ${profile.storePath}`,
    `Updated: ${profile.updatedAt}`,
    `Default mode: ${profile.defaultMode}`,
    '',
    'Channels:',
  ];

  for (const channel of profile.channels) {
    lines.push(
      `- ${channel.channel}: ${channel.enabled ? 'enabled' : 'disabled'} mode=${channel.mode} outbound=${channel.allowOutbound ? 'yes' : 'no'} approval=${channel.requireApprovalForTools ? 'yes' : 'no'}`,
    );
  }
  return lines.join('\n');
}

export function formatCompanionGatewayMessageResult(result: CompanionGatewayMessageResult): string {
  const lines = [
    result.accepted ? 'Companion gateway message accepted.' : 'Companion gateway message ignored.',
    `Reason: ${result.reason}`,
    `Session: ${result.sessionKey}`,
    `Channel: ${result.channel.channel} (${result.channel.mode})`,
  ];
  if (result.percept) lines.push(`Percept recorded: ${result.percept.id}`);
  if (result.safetyEvent) lines.push(`Safety event recorded: ${result.safetyEvent.id}`);
  if (result.inboxItem) {
    lines.push(
      `Inbox item: ${result.inboxItem.id} ${result.inboxItem.priority}/${result.inboxItem.status} ${result.inboxItem.proposedAction.type}`,
    );
  }
  return lines.join('\n');
}
