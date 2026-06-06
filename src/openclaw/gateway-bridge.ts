import { mkdir, readFile, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { ChannelType } from '../channels/core.js';

export interface OpenClawGatewayDiscoveryOptions {
  home?: string;
  lockfilePath?: string;
  cwd?: string;
  now?: Date;
}

export interface OpenClawGatewayLockfile {
  schemaVersion?: number;
  nodeId?: string;
  pid?: number;
  endpoint?: string;
  wsUrl?: string;
  httpUrl?: string;
  rpcUrl?: string;
  workspace?: string;
  methods?: string[];
  token?: string;
  apiKey?: string;
  secret?: string;
  [key: string]: unknown;
}

export interface OpenClawGatewayDiscovery {
  kind: 'openclaw_gateway_discovery';
  schemaVersion: 1;
  generatedAt: string;
  cwd: string;
  home: string;
  lockfilePath: string;
  found: boolean;
  daemon: {
    nodeId?: string;
    pid?: number;
    endpoint?: string;
    wsUrl?: string;
    httpUrl?: string;
    rpcUrl?: string;
    workspace?: string;
    methods: string[];
  };
  safety: {
    secretsIncluded: false;
    tokenPresent: boolean;
    networkContacted: false;
  };
  recommendations: string[];
}

export interface OpenClawNodeDescriptor {
  kind: 'openclaw_node_descriptor';
  schemaVersion: 1;
  nodeId: string;
  name: string;
  role: 'codebuddy-fleet-bridge';
  methods: string[];
  capabilities: {
    fleetDispatchDraft: true;
    companionGatewayInbox: true;
    outboundReplyPreview: true;
    directGatewaySend: false;
    rawTextStorage: false;
  };
  safety: {
    localOnly: true;
    requiresLocalApproval: true;
    autoDispatch: false;
    secretsIncluded: false;
  };
}

export interface OpenClawInboundMessage {
  id: string;
  channel: string;
  text: string;
  senderId: string;
  senderName?: string;
  threadId?: string;
  messageId?: string;
  contentType?: string;
  attachmentCount?: number;
}

export interface OpenClawFleetDispatchDraftInput {
  goal: string;
  parallelism: 1;
  privacyTag: 'sensitive';
  dispatchProfile: 'safe';
  deliveryChannel: string;
  sourceSessionId: string;
}

export interface OpenClawFleetHandoffDraft {
  kind: 'openclaw_fleet_handoff_draft';
  schemaVersion: 1;
  id: string;
  createdAt: string;
  cwd: string;
  draftFile: string;
  source: {
    openclawMessageId: string;
    channel: string;
    senderId: string;
    senderName?: string;
    threadId: string;
    messageId?: string;
    contentType: string;
    attachmentCount: number;
  };
  dispatchInput: OpenClawFleetDispatchDraftInput;
  safety: {
    rawTextStored: false;
    previewOnly: true;
    autoDispatch: false;
    requiresLocalApproval: true;
    directGatewaySend: false;
  };
}

export interface OpenClawBridgeResponsePreview {
  kind: 'openclaw_bridge_response_preview';
  schemaVersion: 1;
  createdAt: string;
  openclawMessageId: string;
  channel: string;
  threadId: string;
  textPreview: string;
  dryRun: true;
  requiresLocalApproval: true;
  safety: {
    rawTextStored: false;
    directGatewaySend: false;
    secretsIncluded: false;
  };
}

export interface OpenClawBridgeOptions {
  cwd?: string;
  now?: Date;
  createId?: () => string;
}

const OPENCLAW_BRIDGE_SCHEMA_VERSION = 1;
const DEFAULT_OPENCLAW_HOME = path.join(os.homedir(), '.openclaw');
const EXECUTION_METHODS = [
  'openclaw.message.ingest',
  'openclaw.message.reply.preview',
  'peer.describe',
  'peer.chat',
  'peer.chat-session.start',
  'peer.chat-session.continue',
  'peer.tool.invoke',
] as const;

function resolveCwd(cwd?: string): string {
  return cwd || process.cwd();
}

function resolveOpenClawHome(options: OpenClawGatewayDiscoveryOptions = {}): string {
  return path.resolve(options.home || DEFAULT_OPENCLAW_HOME);
}

export function getOpenClawGatewayLockfilePath(options: OpenClawGatewayDiscoveryOptions = {}): string {
  return path.resolve(options.lockfilePath || path.join(resolveOpenClawHome(options), 'gateway.json'));
}

function getOpenClawBridgeDraftsDir(cwd: string): string {
  return path.join(cwd, '.codebuddy', 'openclaw', 'bridge');
}

function compactRedactedText(text: string, max = 260): string {
  const redacted = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(?:sk|pk|xox[baprs]|gh[pousr])-[A-Za-z0-9_-]{8,}\b/g, '[redacted-token]')
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)\s*[:=]\s*\S+/gi, '$1=[redacted]');
  if (redacted.length <= max) return redacted;
  return `${redacted.slice(0, max - 15)}... [truncated]`;
}

function safeFileId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 80) || 'message';
}

function normalizeMethods(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))].sort();
}

export async function discoverOpenClawGateway(
  options: OpenClawGatewayDiscoveryOptions = {},
): Promise<OpenClawGatewayDiscovery> {
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const home = resolveOpenClawHome(options);
  const lockfilePath = getOpenClawGatewayLockfilePath({ ...options, home });
  let parsed: OpenClawGatewayLockfile | null = null;
  try {
    parsed = JSON.parse(await readFile(lockfilePath, 'utf8')) as OpenClawGatewayLockfile;
  } catch {
    parsed = null;
  }
  const tokenPresent = Boolean(parsed?.token || parsed?.apiKey || parsed?.secret);
  const recommendations: string[] = [];
  if (!parsed) {
    recommendations.push('Start OpenClaw Gateway or provide --lockfile pointing at gateway.json.');
  }
  if (parsed && !parsed.wsUrl && !parsed.endpoint && !parsed.rpcUrl) {
    recommendations.push('OpenClaw gateway lockfile has no endpoint/wsUrl/rpcUrl for bridge attachment.');
  }

  return {
    kind: 'openclaw_gateway_discovery',
    schemaVersion: OPENCLAW_BRIDGE_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    cwd,
    home,
    lockfilePath,
    found: Boolean(parsed),
    daemon: {
      ...(typeof parsed?.nodeId === 'string' ? { nodeId: parsed.nodeId } : {}),
      ...(typeof parsed?.pid === 'number' ? { pid: parsed.pid } : {}),
      ...(typeof parsed?.endpoint === 'string' ? { endpoint: parsed.endpoint } : {}),
      ...(typeof parsed?.wsUrl === 'string' ? { wsUrl: parsed.wsUrl } : {}),
      ...(typeof parsed?.httpUrl === 'string' ? { httpUrl: parsed.httpUrl } : {}),
      ...(typeof parsed?.rpcUrl === 'string' ? { rpcUrl: parsed.rpcUrl } : {}),
      ...(typeof parsed?.workspace === 'string' ? { workspace: parsed.workspace } : {}),
      methods: normalizeMethods(parsed?.methods),
    },
    safety: {
      secretsIncluded: false,
      tokenPresent,
      networkContacted: false,
    },
    recommendations,
  };
}

export function buildOpenClawNodeDescriptor(input: {
  nodeId?: string;
  name?: string;
  extraMethods?: string[];
} = {}): OpenClawNodeDescriptor {
  return {
    kind: 'openclaw_node_descriptor',
    schemaVersion: OPENCLAW_BRIDGE_SCHEMA_VERSION,
    nodeId: input.nodeId || 'codebuddy-openclaw-node',
    name: input.name || 'Code Buddy OpenClaw Bridge',
    role: 'codebuddy-fleet-bridge',
    methods: [...new Set([...EXECUTION_METHODS, ...(input.extraMethods || [])])].sort(),
    capabilities: {
      fleetDispatchDraft: true,
      companionGatewayInbox: true,
      outboundReplyPreview: true,
      directGatewaySend: false,
      rawTextStorage: false,
    },
    safety: {
      localOnly: true,
      requiresLocalApproval: true,
      autoDispatch: false,
      secretsIncluded: false,
    },
  };
}

export async function prepareOpenClawFleetHandoffDraft(
  message: OpenClawInboundMessage,
  options: OpenClawBridgeOptions = {},
): Promise<OpenClawFleetHandoffDraft> {
  if (!message.id.trim()) throw new Error('OpenClaw message id is required');
  if (!message.channel.trim()) throw new Error('OpenClaw message channel is required');
  if (!message.senderId.trim()) throw new Error('OpenClaw senderId is required');
  if (!message.text.trim()) throw new Error('OpenClaw message text is required');

  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const id = options.createId?.() || `openclaw_handoff_${safeFileId(message.id)}_${randomUUID()}`;
  const threadId = message.threadId || message.senderId;
  const draftFile = path.join(getOpenClawBridgeDraftsDir(cwd), `${safeFileId(id)}.fleet.json`);
  const preview = compactRedactedText(message.text);
  const dispatchInput: OpenClawFleetDispatchDraftInput = {
    goal: [
      'OpenClaw gateway handoff for Code Buddy Fleet.',
      `Channel: ${message.channel}`,
      `Sender: ${message.senderName || message.senderId}`,
      `Thread: ${threadId}`,
      `Preview: ${preview || '[empty preview]'}`,
      'Use the preview only; request local approval before any external reply.',
    ].join('\n'),
    parallelism: 1,
    privacyTag: 'sensitive',
    dispatchProfile: 'safe',
    deliveryChannel: `openclaw:${message.channel}`,
    sourceSessionId: `openclaw:${message.channel}:${threadId}`,
  };
  const draft: OpenClawFleetHandoffDraft = {
    kind: 'openclaw_fleet_handoff_draft',
    schemaVersion: OPENCLAW_BRIDGE_SCHEMA_VERSION,
    id,
    createdAt: now.toISOString(),
    cwd,
    draftFile,
    source: {
      openclawMessageId: message.id,
      channel: message.channel,
      senderId: message.senderId,
      ...(message.senderName ? { senderName: message.senderName } : {}),
      threadId,
      ...(message.messageId ? { messageId: message.messageId } : {}),
      contentType: message.contentType || 'text',
      attachmentCount: message.attachmentCount || 0,
    },
    dispatchInput,
    safety: {
      rawTextStored: false,
      previewOnly: true,
      autoDispatch: false,
      requiresLocalApproval: true,
      directGatewaySend: false,
    },
  };
  await mkdir(path.dirname(draftFile), { recursive: true });
  await writeFile(draftFile, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
  return draft;
}

export function buildOpenClawResponsePreview(input: {
  openclawMessageId: string;
  channel: string;
  threadId: string;
  text: string;
  now?: Date;
}): OpenClawBridgeResponsePreview {
  if (!input.text.trim()) throw new Error('response text is required');
  return {
    kind: 'openclaw_bridge_response_preview',
    schemaVersion: OPENCLAW_BRIDGE_SCHEMA_VERSION,
    createdAt: (input.now || new Date()).toISOString(),
    openclawMessageId: input.openclawMessageId,
    channel: input.channel,
    threadId: input.threadId,
    textPreview: compactRedactedText(input.text),
    dryRun: true,
    requiresLocalApproval: true,
    safety: {
      rawTextStored: false,
      directGatewaySend: false,
      secretsIncluded: false,
    },
  };
}

export function mapOpenClawChannelToCodeBuddy(value: string): ChannelType | 'webchat' {
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, ChannelType> = {
    telegram: 'telegram',
    discord: 'discord',
    slack: 'slack',
    whatsapp: 'whatsapp',
    signal: 'signal',
    matrix: 'matrix',
    teams: 'teams',
    gmail: 'gmail',
    email: 'gmail',
    imessage: 'imessage',
    web: 'web',
    webchat: 'webchat',
  };
  return aliases[normalized] || 'webchat';
}
