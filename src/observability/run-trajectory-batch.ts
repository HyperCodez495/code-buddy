import {
  buildRunTrajectoryExport,
  RUN_TRAJECTORY_EXPORT_SCHEMA_VERSION,
  type RunTrajectoryExport,
} from './run-trajectory-export.js';
import {
  RunStore,
  type RunSummary,
} from './run-store.js';

export const RUN_TRAJECTORY_BATCH_SCHEMA_VERSION = 1;

export interface BuildRunTrajectoryBatchExportOptions {
  includeArtifactContent?: boolean;
  limit?: number;
  maxArtifactBytes?: number;
  maxCompressedBytes?: number;
  maxEventValueBytes?: number;
  query?: string;
  runIds?: string[];
  sources?: string[];
  store?: RunStore;
}

export interface RunTrajectoryBatchExport {
  schemaVersion: 1;
  generatedAt: string;
  kind: 'run_trajectory_batch_export';
  mode: 'redacted_batch_review_export';
  selection: {
    limit: number;
    query?: string;
    requestedRunIds: string[];
    selectedRunIds: string[];
    skippedRunIds: string[];
    sources: string[];
  };
  privacy: {
    artifactContentIncluded: boolean;
    maxArtifactBytes: number;
    maxCompressedBytes: number;
    maxEventValueBytes: number;
    redaction: 'secrets-redacted';
    redactionCount: number;
  };
  schemaVersions: {
    trajectoryExport: number;
  };
  summary: {
    artifactCount: number;
    cancelledCount: number;
    completedCount: number;
    eventCount: number;
    failedCount: number;
    runCount: number;
    runningCount: number;
    toolCallCount: number;
    toolResultCount: number;
  };
  compressed: {
    format: 'agent_recall_context';
    maxBytes: number;
    sourceRunIds: string[];
    text: string;
    truncated: boolean;
  };
  trajectories: RunTrajectoryExport[];
}

const DEFAULT_LIMIT = 5;
const DEFAULT_MAX_ARTIFACT_BYTES = 4_000;
const DEFAULT_MAX_COMPRESSED_BYTES = 12_000;
const DEFAULT_MAX_EVENT_VALUE_BYTES = 2_000;

export function buildRunTrajectoryBatchExport(
  options: BuildRunTrajectoryBatchExportOptions = {},
): RunTrajectoryBatchExport {
  const store = options.store ?? RunStore.getInstance();
  const limit = normalizeLimit(options.limit);
  const sources = normalizeSourceFilters(options.sources);
  const requestedRunIds = normalizeRunIds(options.runIds);
  const selectedRunIds = selectRunIds(store, {
    limit,
    query: options.query,
    requestedRunIds,
    sources,
  });
  const skippedRunIds: string[] = [];
  const trajectories: RunTrajectoryExport[] = [];
  const maxArtifactBytes = normalizeMaxBytes(options.maxArtifactBytes, DEFAULT_MAX_ARTIFACT_BYTES);
  const maxEventValueBytes = normalizeMaxBytes(options.maxEventValueBytes, DEFAULT_MAX_EVENT_VALUE_BYTES);
  const maxCompressedBytes = normalizeMaxBytes(options.maxCompressedBytes, DEFAULT_MAX_COMPRESSED_BYTES);

  for (const runId of selectedRunIds) {
    const trajectory = buildRunTrajectoryExport(runId, {
      includeArtifactContent: options.includeArtifactContent === true,
      maxArtifactBytes,
      maxEventValueBytes,
      store,
    });
    if (trajectory) {
      trajectories.push(trajectory);
    } else {
      skippedRunIds.push(runId);
    }
  }

  const compressed = buildCompressedContext(trajectories, maxCompressedBytes);

  return {
    schemaVersion: RUN_TRAJECTORY_BATCH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    kind: 'run_trajectory_batch_export',
    mode: 'redacted_batch_review_export',
    selection: {
      limit,
      query: normalizeOptionalText(options.query),
      requestedRunIds,
      selectedRunIds: trajectories.map((trajectory) => trajectory.run.runId),
      skippedRunIds,
      sources,
    },
    privacy: {
      artifactContentIncluded: options.includeArtifactContent === true,
      maxArtifactBytes,
      maxCompressedBytes,
      maxEventValueBytes,
      redaction: 'secrets-redacted',
      redactionCount: trajectories.reduce((sum, trajectory) => sum + trajectory.privacy.redactionCount, 0),
    },
    schemaVersions: {
      trajectoryExport: RUN_TRAJECTORY_EXPORT_SCHEMA_VERSION,
    },
    summary: summarizeTrajectories(trajectories),
    compressed,
    trajectories,
  };
}

export function renderRunTrajectoryBatchExport(batch: RunTrajectoryBatchExport): string {
  const lines = [
    'Run trajectory batch export',
    `Mode: ${batch.mode}`,
    `Runs: ${batch.summary.runCount}; events: ${batch.summary.eventCount}; tools: ${batch.summary.toolCallCount}/${batch.summary.toolResultCount}; artifacts: ${batch.summary.artifactCount}`,
    `Selection: ${batch.selection.query ? `query="${batch.selection.query}"` : 'explicit/recent runs'}; sources=${batch.selection.sources.join(',') || 'all'}`,
    `Privacy: ${batch.privacy.redaction}; redactions=${batch.privacy.redactionCount}; artifactContentIncluded=${batch.privacy.artifactContentIncluded}`,
    '',
    batch.compressed.text,
  ];

  if (batch.selection.skippedRunIds.length > 0) {
    lines.push('', `Skipped runs: ${batch.selection.skippedRunIds.join(', ')}`);
  }

  return lines.join('\n');
}

function selectRunIds(
  store: RunStore,
  input: {
    limit: number;
    query?: string;
    requestedRunIds: string[];
    sources: string[];
  },
): string[] {
  if (input.requestedRunIds.length > 0) {
    return input.requestedRunIds.slice(0, input.limit);
  }

  const query = input.query?.trim();
  if (query) {
    return uniqueInOrder(store.searchRuns(query, {
      limit: input.limit,
      sources: input.sources,
    }).map((result) => result.runId));
  }

  return store
    .listRuns(input.limit * 3)
    .filter((summary) => matchesSources(summary, input.sources))
    .slice(0, input.limit)
    .map((summary) => summary.runId);
}

function summarizeTrajectories(trajectories: RunTrajectoryExport[]): RunTrajectoryBatchExport['summary'] {
  return {
    artifactCount: trajectories.reduce((sum, trajectory) => sum + trajectory.artifacts.length, 0),
    cancelledCount: trajectories.filter((trajectory) => trajectory.run.status === 'cancelled').length,
    completedCount: trajectories.filter((trajectory) => trajectory.run.status === 'completed').length,
    eventCount: trajectories.reduce((sum, trajectory) => sum + trajectory.events.length, 0),
    failedCount: trajectories.filter((trajectory) => trajectory.run.status === 'failed').length,
    runCount: trajectories.length,
    runningCount: trajectories.filter((trajectory) => trajectory.run.status === 'running').length,
    toolCallCount: trajectories.reduce((sum, trajectory) => sum + trajectory.toolCalls.length, 0),
    toolResultCount: trajectories.reduce((sum, trajectory) => sum + trajectory.toolResults.length, 0),
  };
}

function buildCompressedContext(
  trajectories: RunTrajectoryExport[],
  maxBytes: number,
): RunTrajectoryBatchExport['compressed'] {
  const lines = [
    '# Trajectory batch recall context',
    '',
    `Runs: ${trajectories.length}`,
  ];

  for (const trajectory of trajectories) {
    lines.push(
      '',
      `## ${trajectory.run.runId}`,
      `Status: ${trajectory.run.status}`,
      `Source: ${trajectory.run.source ?? 'unknown'}`,
      `Objective: ${trajectory.run.objective}`,
      `Prompt: ${trajectory.prompt.text || '(none detected)'}`,
      `Tools: ${trajectory.toolCalls.map((call) => call.toolName).join(' -> ') || '(none)'}`,
      `Artifacts: ${trajectory.artifacts.map((artifact) => artifact.name).join(', ') || '(none)'}`,
    );
    if (trajectory.finalAnswer !== undefined) {
      lines.push(`Final: ${formatInlineValue(trajectory.finalAnswer)}`);
    }
  }

  const fullText = lines.join('\n');
  const text = clipText(fullText, maxBytes);
  return {
    format: 'agent_recall_context',
    maxBytes,
    sourceRunIds: trajectories.map((trajectory) => trajectory.run.runId),
    text,
    truncated: text.length !== fullText.length,
  };
}

function matchesSources(summary: RunSummary, sources: string[]): boolean {
  if (sources.length === 0) return true;
  const candidates = new Set(runSourceCandidates(summary).flatMap((value) => expandSourceAlias(value)));
  return sources.some((source) => candidates.has(source));
}

function runSourceCandidates(summary: RunSummary): string[] {
  const metadata = summary.metadata as (RunSummary['metadata'] & Record<string, unknown>) | undefined;
  return uniqueInOrder([
    metadata?.channel,
    metadata?.source,
    metadata?.platform,
    metadata?.origin,
    ...(Array.isArray(metadata?.tags) ? metadata.tags : []),
  ].filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean));
}

function normalizeSourceFilters(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return uniqueInOrder(values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .flatMap((value) => expandSourceAlias(value)));
}

function expandSourceAlias(value: string): string[] {
  switch (value) {
    case 'cli':
    case 'terminal':
      return ['cli', 'terminal'];
    case 'cowork':
    case 'desktop':
      return ['cowork', 'desktop'];
    case 'scheduled':
    case 'schedule':
    case 'cron':
      return ['scheduled', 'schedule', 'cron'];
    case 'phone':
    case 'mobile':
      return ['mobile', 'phone'];
    default:
      return [value];
  }
}

function normalizeRunIds(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return uniqueInOrder(values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean));
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(50, Math.max(1, Math.trunc(value as number)));
}

function normalizeMaxBytes(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(100_000, Math.max(200, Math.trunc(value as number)));
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function clipText(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text;
  return `${text.slice(0, maxBytes)}... [truncated]`;
}

function formatInlineValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function uniqueInOrder<T>(values: T[]): T[] {
  return [...new Set(values)];
}
