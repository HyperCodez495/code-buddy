export const AGENT_RUN_SCHEMA_VERSION = 1;
export const AGENT_RUN_METADATA_KEY = 'agentRun';

export type AgentRunSource =
  | 'api'
  | 'cli'
  | 'cowork'
  | 'fleet'
  | 'gateway'
  | 'mobile'
  | 'scheduled'
  | 'test';

export type AgentRunStatus = 'draft' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AgentRunToolPolicy {
  allowedTools?: string[];
  deniedTools?: string[];
  profile?: string;
  summary?: string;
  toolsetId?: string;
}

export interface AgentRunLineage {
  deliveryChannel?: string;
  hermesPlanId?: string;
  hermesPlanProfile?: string;
  hermesPlanSurface?: string;
  outcomeId?: string;
  parentRunId?: string;
  planId?: string;
  sagaId?: string;
  scheduleTaskId?: string;
  sourceSessionId?: string;
}

export interface AgentRunMemoryContext {
  count: number;
  included: boolean;
  sourceIds?: string[];
}

export interface AgentRunFleetContext {
  peerCount?: number;
  targetPeerIds?: string[];
  targetPeerLabels?: string[];
}

export interface AgentRunProofContext {
  assertionCount?: number;
  requiredCount?: number;
  stepCount?: number;
  steps?: Array<Record<string, unknown>>;
  tools?: string[];
}

export interface AgentRunArtifact {
  kind: 'artifact' | 'document' | 'image' | 'script' | 'trace' | 'vault';
  path: string;
  title?: string;
}

export interface AgentRun {
  schemaVersion: typeof AGENT_RUN_SCHEMA_VERSION;
  id: string;
  source: AgentRunSource;
  status: AgentRunStatus;
  createdAt: string;
  prompt: string;
  artifacts?: AgentRunArtifact[];
  cwd?: string;
  fleet?: AgentRunFleetContext;
  lineage?: AgentRunLineage;
  memory?: AgentRunMemoryContext;
  metadata?: Record<string, unknown>;
  privacyTag?: string;
  profile?: string;
  proof?: AgentRunProofContext;
  title?: string;
  toolPolicy?: AgentRunToolPolicy;
}

export interface BuildAgentRunInput {
  source: AgentRunSource;
  prompt: string;
  artifacts?: AgentRunArtifact[];
  createdAt?: Date | number | string;
  cwd?: string;
  fleet?: AgentRunFleetContext;
  id?: string;
  lineage?: AgentRunLineage;
  memory?: AgentRunMemoryContext;
  metadata?: Record<string, unknown>;
  privacyTag?: string;
  profile?: string;
  proof?: AgentRunProofContext;
  status?: AgentRunStatus;
  title?: string;
  toolPolicy?: AgentRunToolPolicy;
}

export function buildAgentRun(input: BuildAgentRunInput): AgentRun {
  const prompt = input.prompt.trim();
  const createdAt = normalizeCreatedAt(input.createdAt);
  const cwd = normalizeString(input.cwd);
  const privacyTag = normalizeString(input.privacyTag);
  const profile = normalizeString(input.profile);
  const title = normalizeString(input.title);
  const lineage = compactRecord(input.lineage);
  const fleet = compactFleet(input.fleet);
  const proof = compactProof(input.proof);
  const memory = compactMemory(input.memory);
  const toolPolicy = compactRecord(input.toolPolicy);
  const artifacts = compactArtifacts(input.artifacts);
  const metadata = compactRecord(input.metadata);
  const id =
    normalizeString(input.id) ??
    buildAgentRunId(input.source, [
      prompt,
      createdAt,
      title,
      profile,
      lineage?.parentRunId,
      lineage?.planId,
      lineage?.sagaId,
      lineage?.scheduleTaskId,
    ]);

  return {
    schemaVersion: AGENT_RUN_SCHEMA_VERSION,
    id,
    source: input.source,
    status: input.status ?? 'draft',
    createdAt,
    prompt,
    ...(artifacts.length > 0 ? { artifacts } : {}),
    ...(cwd ? { cwd } : {}),
    ...(fleet ? { fleet } : {}),
    ...(lineage ? { lineage } : {}),
    ...(memory ? { memory } : {}),
    ...(metadata ? { metadata } : {}),
    ...(privacyTag ? { privacyTag } : {}),
    ...(profile ? { profile } : {}),
    ...(proof ? { proof } : {}),
    ...(title ? { title } : {}),
    ...(toolPolicy ? { toolPolicy } : {}),
  };
}

export function isAgentRun(value: unknown): value is AgentRun {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === AGENT_RUN_SCHEMA_VERSION &&
    typeof value.id === 'string' &&
    typeof value.source === 'string' &&
    typeof value.status === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.prompt === 'string'
  );
}

export function buildAgentRunMetadata(agentRun: AgentRun): Record<string, unknown> {
  return {
    [AGENT_RUN_METADATA_KEY]: agentRun,
    agentRunId: agentRun.id,
    agentRunSchemaVersion: agentRun.schemaVersion,
  };
}

export function buildAgentRunId(source: AgentRunSource, parts: Array<string | null | undefined>): string {
  const seed = [source, ...parts.map((part) => part?.trim()).filter(Boolean)].join('|');
  return `agent-run-${source}-${stableHash(seed)}`;
}

function normalizeCreatedAt(value: Date | number | string | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string' && value.trim()) return value.trim();
  return new Date().toISOString();
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function compactArtifacts(value: AgentRunArtifact[] | undefined): AgentRunArtifact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((artifact) => ({
      kind: artifact.kind,
      path: artifact.path.trim(),
      ...(normalizeString(artifact.title) ? { title: normalizeString(artifact.title) } : {}),
    }))
    .filter((artifact) => artifact.path.length > 0);
}

function compactMemory(value: AgentRunMemoryContext | undefined): AgentRunMemoryContext | undefined {
  if (!value) return undefined;
  const sourceIds = normalizeStringList(value.sourceIds);
  return {
    included: value.included,
    count: Math.max(0, Math.trunc(value.count)),
    ...(sourceIds.length > 0 ? { sourceIds } : {}),
  };
}

function compactFleet(value: AgentRunFleetContext | undefined): AgentRunFleetContext | undefined {
  if (!value) return undefined;
  return compactRecord({
    ...(typeof value.peerCount === 'number' && Number.isFinite(value.peerCount)
      ? { peerCount: Math.max(0, Math.trunc(value.peerCount)) }
      : {}),
    targetPeerIds: normalizeStringList(value.targetPeerIds),
    targetPeerLabels: normalizeStringList(value.targetPeerLabels),
  }) as AgentRunFleetContext | undefined;
}

function compactProof(value: AgentRunProofContext | undefined): AgentRunProofContext | undefined {
  if (!value) return undefined;
  return compactRecord({
    assertionCount: normalizeCount(value.assertionCount),
    requiredCount: normalizeCount(value.requiredCount),
    stepCount: normalizeCount(value.stepCount),
    steps: Array.isArray(value.steps) && value.steps.length > 0 ? value.steps : undefined,
    tools: normalizeStringList(value.tools),
  }) as AgentRunProofContext | undefined;
}

function normalizeCount(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : undefined;
}

function normalizeStringList(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => item.trim()).filter(Boolean);
}

function compactRecord<T extends object>(value: T | undefined): T | undefined {
  if (!value) return undefined;
  const entries: Array<[string, unknown]> = Object.entries(value).flatMap(([key, child]): Array<[string, unknown]> => {
    if (child === undefined || child === null) return [];
    if (typeof child === 'string') {
      const trimmed = child.trim();
      return trimmed ? [[key, trimmed]] : [];
    }
    if (Array.isArray(child)) return child.length > 0 ? [[key, child]] : [];
    return [[key, child]];
  });
  return entries.length > 0 ? Object.fromEntries(entries) as T : undefined;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
