import { mkdir, readFile, writeFile } from 'fs/promises';
import * as path from 'path';
import type { ChannelType, ContentType } from '../channels/core.js';
import { readSendMessageOutbox } from '../channels/send-message.js';
import { recordCompanionPercept, type CompanionPercept } from './percepts.js';
import { recordCompanionSafetyEvent, type CompanionSafetyEvent } from './safety-ledger.js';
import {
  readCompanionGatewayInbox,
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

export type CompanionGatewayLifecycleState = 'disabled' | 'observe' | 'ready' | 'needs_attention';

export interface CompanionGatewayLifecycleChannel {
  channel: ChannelType;
  state: CompanionGatewayLifecycleState;
  enabled: boolean;
  mode: CompanionGatewayMode;
  allowOutbound: boolean;
  requireApprovalForTools: boolean;
  recordPercepts: boolean;
  queueCount: number;
  ignoredCount: number;
  draftCount: number;
  fleetDraftCount: number;
  replyDraftCount: number;
  lastSendStatus?: 'preview' | 'sent' | 'failed' | 'blocked';
  issues: string[];
}

export interface CompanionGatewayLifecycleReport {
  kind: 'companion_gateway_lifecycle';
  schemaVersion: 1;
  generatedAt: string;
  cwd: string;
  profilePath: string;
  inboxPath: string;
  outboxPath: string;
  summary: {
    channelCount: number;
    enabledCount: number;
    actModeCount: number;
    queuedCount: number;
    ignoredCount: number;
    draftCount: number;
    fleetDraftCount: number;
    replyDraftCount: number;
    outboundSendCount: number;
    failedSendCount: number;
    blockedSendCount: number;
    readyChannelCount: number;
    attentionChannelCount: number;
  };
  safety: {
    autoDispatch: false;
    rawTextStored: false;
    localApprovalRequired: true;
    sendPolicyRequired: true;
  };
  channels: CompanionGatewayLifecycleChannel[];
  recommendations: string[];
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

function lifecycleStateFor(
  channel: CompanionGatewayChannelConfig,
  issues: string[],
): CompanionGatewayLifecycleState {
  if (!channel.enabled) return 'disabled';
  if (channel.mode === 'observe') return 'observe';
  return issues.length > 0 ? 'needs_attention' : 'ready';
}

function lastSendStatusFor(item: CompanionGatewayInboxItem): 'preview' | 'sent' | 'failed' | 'blocked' | undefined {
  return item.draft?.fleet?.outboundReply?.lastSend?.status;
}

export async function buildCompanionGatewayLifecycleReport(
  options: CompanionGatewayOptions = {},
): Promise<CompanionGatewayLifecycleReport> {
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const [profile, inbox, outbox] = await Promise.all([
    readCompanionGatewayProfile({ ...options, cwd, now }),
    readCompanionGatewayInbox({ cwd, now }),
    readSendMessageOutbox(cwd),
  ]);
  const itemsByChannel = new Map<ChannelType, CompanionGatewayInboxItem[]>();
  for (const item of inbox.items) {
    const existing = itemsByChannel.get(item.channel) || [];
    existing.push(item);
    itemsByChannel.set(item.channel, existing);
  }

  const channels = profile.channels.map((channel) => {
    const items = itemsByChannel.get(channel.channel) || [];
    const queueCount = items.filter(item => item.status === 'queued').length;
    const ignoredCount = items.filter(item => item.status === 'ignored').length;
    const draftCount = items.filter(item => Boolean(item.draft)).length;
    const fleetDraftCount = items.filter(item => Boolean(item.draft?.fleet)).length;
    const replyDraftCount = items.filter(item => Boolean(item.draft?.fleet?.outboundReply)).length;
    const lastSendStatus = items.map(lastSendStatusFor).find(Boolean);
    const issues: string[] = [];
    if (channel.enabled && channel.mode !== 'observe' && queueCount > 0) {
      issues.push('queued gateway items require local review');
    }
    if (channel.enabled && channel.mode === 'act' && !channel.allowOutbound) {
      issues.push('act mode is enabled while outbound remains disabled');
    }
    if (lastSendStatus === 'failed' || lastSendStatus === 'blocked') {
      issues.push(`last outbound reply send is ${lastSendStatus}`);
    }
    return {
      channel: channel.channel,
      state: lifecycleStateFor(channel, issues),
      enabled: channel.enabled,
      mode: channel.mode,
      allowOutbound: channel.allowOutbound,
      requireApprovalForTools: channel.requireApprovalForTools,
      recordPercepts: channel.recordPercepts,
      queueCount,
      ignoredCount,
      draftCount,
      fleetDraftCount,
      replyDraftCount,
      ...(lastSendStatus ? { lastSendStatus } : {}),
      issues,
    };
  });

  const recommendations: string[] = [];
  if (profile.channels.every(channel => !channel.enabled)) {
    recommendations.push('Enable at least one companion gateway channel for supervised human-channel intake.');
  }
  if (inbox.counts.queued > 0) {
    recommendations.push('Review queued gateway inbox items before launching Fleet or sending replies.');
  }
  if (channels.some(channel => channel.state === 'needs_attention')) {
    recommendations.push('Inspect channels marked needs_attention before treating the gateway as OpenClaw-ready.');
  }
  if (outbox.some(entry => entry.status === 'failed' || entry.status === 'blocked')) {
    recommendations.push('Inspect .codebuddy/messages/outbox.jsonl for blocked or failed outbound replies.');
  }

  return {
    kind: 'companion_gateway_lifecycle',
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    cwd,
    profilePath: profile.storePath,
    inboxPath: inbox.storePath,
    outboxPath: path.join(cwd, '.codebuddy', 'messages', 'outbox.jsonl'),
    summary: {
      channelCount: profile.channels.length,
      enabledCount: profile.channels.filter(channel => channel.enabled).length,
      actModeCount: profile.channels.filter(channel => channel.mode === 'act').length,
      queuedCount: inbox.counts.queued,
      ignoredCount: inbox.counts.ignored,
      draftCount: inbox.items.filter(item => Boolean(item.draft)).length,
      fleetDraftCount: inbox.items.filter(item => Boolean(item.draft?.fleet)).length,
      replyDraftCount: inbox.items.filter(item => Boolean(item.draft?.fleet?.outboundReply)).length,
      outboundSendCount: outbox.length,
      failedSendCount: outbox.filter(entry => entry.status === 'failed').length,
      blockedSendCount: outbox.filter(entry => entry.status === 'blocked').length,
      readyChannelCount: channels.filter(channel => channel.state === 'ready').length,
      attentionChannelCount: channels.filter(channel => channel.state === 'needs_attention').length,
    },
    safety: {
      autoDispatch: false,
      rawTextStored: false,
      localApprovalRequired: true,
      sendPolicyRequired: true,
    },
    channels,
    recommendations,
  };
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
