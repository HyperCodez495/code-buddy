import {
  proofSchema,
  runEventSchema,
  runSchema,
  type Actor,
  type Proof,
  type ProofType,
  type Run,
  type RunEvent,
  type RunStatus,
} from './contract.js';
import type {
  RunEvent as StoreRunEvent,
  RunMetadata as StoreRunMetadata,
  RunMetrics as StoreRunMetrics,
  RunSummary as StoreRunSummary,
} from '../observability/run-store.js';

function actorFromMetadata(metadata: StoreRunMetadata | undefined): Actor {
  const organ = extractOrgan(metadata);
  return {
    type: 'agent',
    id: organ || 'code-buddy',
  };
}

function extractOrgan(metadata: StoreRunMetadata | undefined): string | undefined {
  const organ = metadata?.tags?.find((tag) => tag.startsWith('organ:'))?.slice('organ:'.length);
  return organ || undefined;
}

function normalizeRunStatus(status: StoreRunSummary['status']): RunStatus {
  return status;
}

export function runSummaryToHarnessRun(
  summary: StoreRunSummary,
  metrics?: Partial<StoreRunMetrics>,
): Run {
  return runSchema.parse({
    kind: 'run',
    schemaVersion: 1,
    id: summary.runId,
    actor: actorFromMetadata(summary.metadata),
    parentRunId: summary.metadata?.parentRolloutId,
    objective: summary.objective,
    status: normalizeRunStatus(summary.status),
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    metrics,
    metadata: {
      channel: summary.metadata?.channel,
      userId: summary.metadata?.userId,
      sessionId: summary.metadata?.sessionId,
      organ: extractOrgan(summary.metadata),
      tags: summary.metadata?.tags ?? [],
    },
  });
}

export function runStoreEventToHarnessEvent(event: StoreRunEvent): RunEvent {
  return runEventSchema.parse({
    ts: event.ts,
    type: event.type,
    runId: event.runId,
    data: event.data,
  });
}

export function artifactToHarnessProof(input: {
  runId: string;
  artifact: string;
  summary: string;
  type?: ProofType;
  createdAt?: number;
  producedBy?: Actor;
}): Proof {
  const safeArtifactId = input.artifact
    .replace(/[^A-Za-z0-9._:-]+/g, '_')
    .slice(0, 72);
  return proofSchema.parse({
    kind: 'proof',
    schemaVersion: 1,
    id: `proof_${input.runId}_${safeArtifactId}`.slice(0, 120),
    runId: input.runId,
    type: input.type ?? 'artifact',
    createdAt: input.createdAt ?? Date.now(),
    producedBy: input.producedBy ?? { type: 'agent', id: 'code-buddy' },
    summary: input.summary,
    ref: input.artifact,
  });
}
