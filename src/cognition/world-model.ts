export type EntityVisibility = 'visible' | 'absent' | 'unknown';

export interface WorldProvenance {
  source: string;
  kind: string;
  eventId: string;
  observedAt: number;
  receivedAt: number;
}

export interface ObservationCursor {
  observedAt: number;
  transitionRank: number;
  eventId: string;
}

export interface WorldObservation {
  eventId: string;
  entityId: string;
  entityType: string;
  visibility: Exclude<EntityVisibility, 'unknown'>;
  observedAt: number;
  receivedAt: number;
  confidence: number;
  source: string;
  kind: string;
  ttlMs: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface WorldEntity {
  id: string;
  type: string;
  visibility: EntityVisibility;
  firstSeen: number | null;
  lastSeen: number | null;
  lastObservedAt: number;
  lastUpdatedAt: number;
  expiresAt: number | null;
  confidence: number;
  attributes: Readonly<Record<string, string | number | boolean>>;
  provenance: readonly WorldProvenance[];
  observationCursor: Readonly<ObservationCursor>;
  revision: number;
}

export type WorldObservationResult =
  | { applied: true; entity: WorldEntity }
  | { applied: false; reason: 'duplicate' | 'stale' | 'invalid' };

export interface WorldModelOptions {
  capacity?: number;
  eventCapacity?: number;
  maxFutureSkewMs?: number;
  maxObservationAgeMs?: number;
}

function immutableEntity(entity: WorldEntity): WorldEntity {
  return Object.freeze({
    ...entity,
    attributes: Object.freeze({ ...entity.attributes }),
    provenance: Object.freeze(entity.provenance.map((item) => Object.freeze({ ...item }))),
    observationCursor: Object.freeze({ ...entity.observationCursor }),
  });
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Deterministic, bounded operational model of the observed physical world.
 * LLMs may publish hypotheses elsewhere, but only validated observations enter
 * this reducer and change factual entity state.
 */
export class WorldModel {
  private readonly entities = new Map<string, WorldEntity>();
  private readonly seenEvents = new Map<string, number>();
  private readonly capacity: number;
  private readonly eventCapacity: number;
  private readonly maxFutureSkewMs: number;
  private readonly maxObservationAgeMs: number;
  private revision = 0;

  constructor(options: WorldModelOptions = {}) {
    this.capacity = Math.max(1, Math.floor(options.capacity ?? 128));
    this.eventCapacity = Math.max(1, Math.floor(options.eventCapacity ?? 2048));
    this.maxFutureSkewMs = Math.max(0, Math.floor(options.maxFutureSkewMs ?? 30_000));
    this.maxObservationAgeMs = Math.max(1, Math.floor(options.maxObservationAgeMs ?? 86_400_000));
  }

  observe(observation: WorldObservation): WorldObservationResult {
    if (!this.validObservation(observation)) return { applied: false, reason: 'invalid' };
    if (this.seenEvents.has(observation.eventId)) return { applied: false, reason: 'duplicate' };
    this.rememberEvent(observation.eventId, observation.receivedAt);

    const previous = this.entities.get(observation.entityId);
    const cursor: ObservationCursor = {
      observedAt: observation.observedAt,
      transitionRank: observation.visibility === 'absent' ? 2 : 1,
      eventId: observation.eventId,
    };
    if (previous && this.compareCursor(cursor, previous.observationCursor) <= 0) {
      // A delayed visible sample can widen historical firstSeen without
      // changing the newer current belief. Delayed absence never does.
      if (
        observation.visibility === 'visible' &&
        (previous.firstSeen === null || observation.observedAt < previous.firstSeen)
      ) {
        const widened = immutableEntity({
          ...previous,
          firstSeen: observation.observedAt,
          provenance: [
            ...previous.provenance.slice(-7),
            {
              source: observation.source,
              kind: observation.kind,
              eventId: observation.eventId,
              observedAt: observation.observedAt,
              receivedAt: observation.receivedAt,
            },
          ],
          revision: ++this.revision,
        });
        this.entities.set(widened.id, widened);
        return { applied: true, entity: widened };
      }
      return { applied: false, reason: 'stale' };
    }

    if (!previous && this.entities.size >= this.capacity) this.evictOne();
    const provenance: WorldProvenance = {
      source: observation.source,
      kind: observation.kind,
      eventId: observation.eventId,
      observedAt: observation.observedAt,
      receivedAt: observation.receivedAt,
    };
    const entity = immutableEntity({
      id: observation.entityId,
      type: observation.entityType,
      visibility: observation.visibility,
      firstSeen: observation.visibility === 'visible'
        ? Math.min(previous?.firstSeen ?? observation.observedAt, observation.observedAt)
        : previous?.firstSeen ?? null,
      lastSeen: observation.visibility === 'visible'
        ? Math.max(previous?.lastSeen ?? observation.observedAt, observation.observedAt)
        : previous?.lastSeen ?? null,
      lastObservedAt: observation.observedAt,
      lastUpdatedAt: observation.receivedAt,
      expiresAt: observation.receivedAt + observation.ttlMs,
      confidence: clamp01(observation.confidence),
      attributes: {
        ...(previous?.attributes ?? {}),
        ...(observation.attributes ?? {}),
      },
      provenance: [...(previous?.provenance ?? []).slice(-7), provenance],
      observationCursor: cursor,
      revision: ++this.revision,
    });
    this.entities.set(entity.id, entity);
    return { applied: true, entity };
  }

  /** Expired observations become unknown; lack of observation is not proof of absence. */
  expire(now: number): WorldEntity[] {
    if (!Number.isFinite(now)) return [];
    const changed: WorldEntity[] = [];
    for (const [id, entity] of this.entities) {
      if (entity.visibility === 'unknown' || entity.expiresAt === null || entity.expiresAt > now) {
        continue;
      }
      const unknown = immutableEntity({
        ...entity,
        visibility: 'unknown',
        lastUpdatedAt: now,
        expiresAt: null,
        confidence: 0,
        revision: ++this.revision,
      });
      this.entities.set(id, unknown);
      changed.push(unknown);
    }
    return changed;
  }

  get(entityId: string, now?: number): WorldEntity | undefined {
    if (now !== undefined) this.expire(now);
    const entity = this.entities.get(entityId);
    return entity ? immutableEntity(entity) : undefined;
  }

  snapshot(now?: number): readonly WorldEntity[] {
    if (now !== undefined) this.expire(now);
    return [...this.entities.values()]
      .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)
      .map(immutableEntity);
  }

  private validObservation(observation: WorldObservation): boolean {
    return Boolean(
      observation.eventId &&
        observation.entityId &&
        observation.entityType &&
        observation.source &&
        observation.kind &&
        Number.isFinite(observation.observedAt) &&
        Number.isFinite(observation.receivedAt) &&
        Number.isFinite(observation.confidence) &&
        Number.isFinite(observation.ttlMs) &&
        observation.ttlMs > 0 &&
        observation.observedAt >= 0 &&
        observation.receivedAt >= 0 &&
        observation.observedAt <= observation.receivedAt + this.maxFutureSkewMs &&
        observation.observedAt >= observation.receivedAt - this.maxObservationAgeMs,
    );
  }

  private compareCursor(a: ObservationCursor, b: ObservationCursor): number {
    if (a.observedAt !== b.observedAt) return a.observedAt - b.observedAt;
    if (a.transitionRank !== b.transitionRank) return a.transitionRank - b.transitionRank;
    return a.eventId.localeCompare(b.eventId);
  }

  private rememberEvent(eventId: string, receivedAt: number): void {
    this.seenEvents.set(eventId, receivedAt);
    if (this.seenEvents.size <= this.eventCapacity) return;
    const oldest = this.seenEvents.keys().next().value as string | undefined;
    if (oldest) this.seenEvents.delete(oldest);
  }

  private evictOne(): void {
    const victim = [...this.entities.values()].sort(
      (a, b) =>
        (a.visibility === 'unknown' ? 0 : 1) - (b.visibility === 'unknown' ? 0 : 1) ||
        a.lastUpdatedAt - b.lastUpdatedAt,
    )[0];
    if (victim) this.entities.delete(victim.id);
  }
}
