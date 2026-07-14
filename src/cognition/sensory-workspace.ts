import { createHash } from 'node:crypto';
import { getGlobalEventBus } from '../events/event-bus.js';
import type { BaseEvent } from '../events/types.js';
import { perceptionOf } from '../sensory/reactions.js';
import { CognitiveMesh } from './cognitive-mesh.js';
import { GlobalWorkspace } from './global-workspace.js';
import type { WorkspaceDraft, WorkspaceItem } from './types.js';
import { WorldModel, type WorldEntity, type WorldObservation } from './world-model.js';

export interface SafeSensoryPercept {
  modality: string;
  kind: string;
  observedAt: number;
  sensorId: string;
  confidence: number;
}

export interface EmbodiedCognitionHandle {
  workspace: GlobalWorkspace;
  mesh: CognitiveMesh;
  worldModel: WorldModel;
  snapshotWorld(now?: number): readonly WorldEntity[];
  sweepWorld(now?: number): readonly WorldEntity[];
  close(): void;
}

function safeSensorId(value: unknown): string {
  if (typeof value !== 'string') return 'primary';
  const safe = value.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 40);
  return safe || 'primary';
}

function safeConfidence(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

function plausibleObservedAt(sensorTimestamp: number | undefined, receivedAt: number): number {
  const epoch2000 = 946_684_800_000;
  return sensorTimestamp !== undefined &&
    Number.isFinite(sensorTimestamp) &&
    sensorTimestamp >= epoch2000 &&
    sensorTimestamp <= receivedAt + 30_000
    ? sensorTimestamp
    : receivedAt;
}

function observationId(percept: SafeSensoryPercept): string {
  return createHash('sha256')
    .update(`${percept.sensorId}\0${percept.modality}\0${percept.kind}\0${percept.observedAt}`)
    .digest('hex');
}

function observationOf(
  trigger: WorkspaceItem<SafeSensoryPercept>,
): WorldObservation | null {
  if (trigger.payload.modality !== 'vision') return null;
  const visibility = trigger.payload.kind === 'person_entered'
    ? 'visible'
    : trigger.payload.kind === 'person_left'
      ? 'absent'
      : null;
  if (!visibility) return null;
  return {
    eventId: observationId(trigger.payload),
    entityId: `person-occupancy:${trigger.payload.sensorId}`,
    entityType: 'person-occupancy',
    visibility,
    observedAt: trigger.payload.observedAt,
    receivedAt: trigger.createdAt,
    confidence: trigger.payload.confidence,
    source: trigger.provenance.source,
    kind: trigger.payload.kind,
    ttlMs: visibility === 'visible' ? 15_000 : 5_000,
  };
}

function factOf(entity: WorldEntity): WorkspaceDraft {
  return {
    kind: 'fact',
    producerId: 'world-model',
    correlationId: `world:${entity.id}`,
    salience: entity.visibility === 'unknown' ? 0.1 : 0.8,
    confidence: entity.confidence,
    privacy: 'local-only',
    provenance: { source: 'deterministic-world-reducer' },
    ttlMs: 30_000,
    dedupeKey: `entity:${entity.id}`,
    payload: entity,
  };
}

/**
 * Shadow-mode adapter: mirrors safe sensory metadata into the cognitive mesh.
 * Raw audio, transcripts, image data, local paths and arbitrary payload fields
 * intentionally never cross this boundary.
 */
export function wireSensoryWorkspace(options: {
  workspace?: GlobalWorkspace;
  mesh?: CognitiveMesh;
  worldModel?: WorldModel;
  now?: () => number;
  worldSweepMs?: number;
} = {}): EmbodiedCognitionHandle {
  const workspace = options.workspace ?? new GlobalWorkspace();
  const mesh = options.mesh ?? new CognitiveMesh(workspace);
  const worldModel = options.worldModel ?? new WorldModel();
  const now = options.now ?? Date.now;
  const publishWorldChanges = (entities: readonly WorldEntity[]): void => {
    for (const entity of entities) mesh.publish(factOf(entity));
  };
  mesh.register({
    id: 'world-model',
    role: 'deterministic embodied state reducer',
    subscriptions: ['percept'],
    privacyClearance: 'local-only',
    mailboxCapacity: 32,
    overflow: 'coalesce-latest',
    activate: async ({ trigger }) => {
      const sensoryTrigger = trigger as WorkspaceItem<SafeSensoryPercept>;
      const drafts = worldModel.expire(trigger.createdAt).map((entity) =>
        factOf(entity),
      );
      const observation = observationOf(sensoryTrigger);
      if (observation) {
        const result = worldModel.observe(observation);
        if (result.applied) drafts.push(factOf(result.entity));
      }
      return drafts;
    },
  });

  let sequence = 0;
  const listenerId = getGlobalEventBus().on('sensory:perception', (event: BaseEvent) => {
    const perception = perceptionOf(event);
    if (!perception.modality || !perception.kind) return;
    const receivedAt = perception.receivedAt ?? event.timestamp;
    const rawPayload =
      perception.payload && typeof perception.payload === 'object'
        ? perception.payload as Record<string, unknown>
        : {};
    const observedAt = plausibleObservedAt(perception.tsMs, receivedAt);
    const semanticConfidence = perception.kind === 'person_entered' || perception.kind === 'person_left'
      ? 0.95
      : 0.8;
    mesh.publish<SafeSensoryPercept>({
      kind: 'percept',
      producerId: `sense:${perception.modality}`,
      correlationId: `sensory:${event.timestamp}:${++sequence}`,
      salience: Math.max(0, Math.min(1, (perception.salience ?? 0) / 255)),
      confidence: safeConfidence(rawPayload.confidence, semanticConfidence),
      privacy: 'local-only',
      provenance: { source: 'sensory-bridge' },
      ttlMs: 10_000,
      payload: {
        modality: perception.modality,
        kind: perception.kind,
        observedAt,
        sensorId: safeSensorId(rawPayload.camera ?? rawPayload.sensorId),
        confidence: safeConfidence(rawPayload.confidence, semanticConfidence),
      },
    });
  });

  const configuredSweep = Math.floor(options.worldSweepMs ?? 1_000);
  const sweepTimer = configuredSweep > 0
    ? setInterval(() => publishWorldChanges(worldModel.expire(now())), configuredSweep)
    : undefined;
  sweepTimer?.unref();

  return {
    workspace,
    mesh,
    worldModel,
    snapshotWorld: (at) => worldModel.snapshot(at),
    sweepWorld: (at = now()) => {
      const changed = worldModel.expire(at);
      publishWorldChanges(changed);
      return changed;
    },
    close: () => {
      getGlobalEventBus().off(listenerId);
      if (sweepTimer) clearInterval(sweepTimer);
      mesh.stop();
    },
  };
}
