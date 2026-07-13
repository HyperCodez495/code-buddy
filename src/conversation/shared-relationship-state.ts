import { detectEmotion, type Emotion } from '../companion/reply-augment.js';
import { buildDeliberationThread } from './deliberation-thread.js';
import type { ConversationTurn, DeliberationPhase } from './types.js';

/**
 * Shared relationship state deliberately contains no dialogue text, excerpts,
 * topic labels, identifiers, or content fingerprints. It is a short-lived set
 * of conversational observations that any Lisa surface can safely consume.
 */
export const SHARED_RELATIONSHIP_SCHEMA_VERSION = 1 as const;
export const MAX_SHARED_RELATIONSHIP_EVENTS = 200;
export const DEFAULT_SHARED_AFFECT_TTL_MS = 2 * 60 * 60 * 1_000;
export const MAX_SHARED_AFFECT_TTL_MS = 24 * 60 * 60 * 1_000;

export type SharedRelationshipRecency =
  | 'none'
  | 'immediate'
  | 'recent'
  | 'today'
  | 'older';

export type SharedAffect = Exclude<Emotion, 'neutral'>;
export type SharedRelationshipSurface = 'voice' | 'channel' | 'cowork';

export interface SharedRelationshipEvent extends ConversationTurn {
  id: string;
  origin: SharedRelationshipSurface;
  timestamp: string;
}

export interface SharedRelationshipSnapshot {
  schemaVersion: typeof SHARED_RELATIONSHIP_SCHEMA_VERSION;
  windowSize: number;
  counters: {
    total: number;
    user: number;
    assistant: number;
    bySurface: Record<SharedRelationshipSurface, number>;
    surfaceTransitions: number;
  };
  surfacesSeen: SharedRelationshipSurface[];
  lastSurface: SharedRelationshipSurface | null;
  lastRole: ConversationTurn['role'] | null;
  lastInteractionAt: string | null;
  recency: SharedRelationshipRecency;
  affect: {
    kind: SharedAffect;
    intensity: 'normal' | 'high';
    observedAt: string;
    expiresAt: string;
    supportOpen: boolean;
  } | null;
  deliberation: {
    active: boolean;
    phase: DeliberationPhase;
    turnCount: number;
    continuedAcrossSurfaces: boolean;
  };
}

export interface SharedRelationshipReductionOptions {
  /** Explicit wall clock. Defaults to the newest event time to keep pure calls deterministic. */
  now?: Date | number;
  affectTtlMs?: number;
}

const SUPPORT_AFFECTS = new Set<SharedAffect>([
  'frustration',
  'sadness',
  'anxiety',
  'tired',
  'deep-talk',
]);

const RESOLUTION =
  /\b(?:ca va mieux|je vais mieux|c est passe|je me sens mieux|tout va bien maintenant|i feel better|i m better|it has passed|i am okay now)\b/;

function normalize(value: string): string {
  return value
    .toLocaleLowerCase('fr')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function timeMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function compareEvents(left: SharedRelationshipEvent, right: SharedRelationshipEvent): number {
  const byTime = timeMs(left.timestamp) - timeMs(right.timestamp);
  if (Number.isFinite(byTime) && byTime !== 0) return byTime;
  const byTimestamp = left.timestamp.localeCompare(right.timestamp);
  if (byTimestamp !== 0) return byTimestamp;
  const byId = left.id.localeCompare(right.id);
  if (byId !== 0) return byId;
  const byOrigin = left.origin.localeCompare(right.origin);
  if (byOrigin !== 0) return byOrigin;
  const byRole = left.role.localeCompare(right.role);
  if (byRole !== 0) return byRole;
  return left.content.localeCompare(right.content);
}

/** Canonicalise input so readers of the same append-only journal derive identical state. */
function canonicalWindow(events: readonly SharedRelationshipEvent[]): SharedRelationshipEvent[] {
  const seen = new Set<string>();
  return [...events]
    .filter((event) => event.content.trim() && Number.isFinite(timeMs(event.timestamp)))
    .sort(compareEvents)
    .filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    })
    .slice(-MAX_SHARED_RELATIONSHIP_EVENTS);
}

function resolveNow(
  events: readonly SharedRelationshipEvent[],
  supplied: Date | number | undefined,
): number {
  const requested = supplied instanceof Date ? supplied.getTime() : supplied;
  if (typeof requested === 'number' && Number.isFinite(requested)) return requested;
  const newest = events.reduce((latest, event) => Math.max(latest, timeMs(event.timestamp)), 0);
  return Number.isFinite(newest) ? newest : 0;
}

function resolveTtl(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_SHARED_AFFECT_TTL_MS;
  return Math.max(1, Math.min(MAX_SHARED_AFFECT_TTL_MS, Math.floor(value)));
}

function recencyFor(lastInteractionMs: number, nowMs: number): SharedRelationshipRecency {
  if (!Number.isFinite(lastInteractionMs) || lastInteractionMs < 0) return 'none';
  const age = Math.max(0, nowMs - lastInteractionMs);
  if (age < 2 * 60 * 1_000) return 'immediate';
  if (age < 30 * 60 * 1_000) return 'recent';
  if (age < 24 * 60 * 60 * 1_000) return 'today';
  return 'older';
}

function emptySnapshot(): SharedRelationshipSnapshot {
  return {
    schemaVersion: SHARED_RELATIONSHIP_SCHEMA_VERSION,
    windowSize: 0,
    counters: {
      total: 0,
      user: 0,
      assistant: 0,
      bySurface: { voice: 0, channel: 0, cowork: 0 },
      surfaceTransitions: 0,
    },
    surfacesSeen: [],
    lastSurface: null,
    lastRole: null,
    lastInteractionAt: null,
    recency: 'none',
    affect: null,
    deliberation: {
      active: false,
      phase: 'idle',
      turnCount: 0,
      continuedAcrossSurfaces: false,
    },
  };
}

/**
 * Pure reduction from raw cross-surface events to an allowlisted, raw-free snapshot.
 * Raw text is inspected transiently for classification and never returned.
 */
export function reduceSharedRelationshipState(
  sourceEvents: readonly SharedRelationshipEvent[],
  options: SharedRelationshipReductionOptions = {},
): SharedRelationshipSnapshot {
  const events = canonicalWindow(sourceEvents);
  if (events.length === 0) return emptySnapshot();

  const nowMs = resolveNow(events, options.now);
  const affectTtlMs = resolveTtl(options.affectTtlMs);
  const counters: SharedRelationshipSnapshot['counters'] = {
    total: events.length,
    user: 0,
    assistant: 0,
    bySurface: { voice: 0, channel: 0, cowork: 0 },
    surfaceTransitions: 0,
  };
  const surfacesSeen = new Set<SharedRelationshipSurface>();
  let previousSurface: SharedRelationshipSurface | undefined;
  let affect: SharedRelationshipSnapshot['affect'] = null;

  for (const event of events) {
    counters[event.role] += 1;
    counters.bySurface[event.origin] += 1;
    surfacesSeen.add(event.origin);
    if (previousSurface !== undefined && previousSurface !== event.origin) {
      counters.surfaceTransitions += 1;
    }
    previousSurface = event.origin;

    if (event.role !== 'user') continue;
    const normalized = normalize(event.content);
    const read = detectEmotion(event.content);
    // A recovery phrase closes support only when the same turn does not also
    // contain an explicit continuing support need. Mixed turns such as
    // “ça va mieux, mais je suis encore très triste” must stay open.
    if (read.emotion !== 'neutral' && SUPPORT_AFFECTS.has(read.emotion)) {
      const observedMs = timeMs(event.timestamp);
      if (!Number.isFinite(observedMs)) continue;
      affect = {
        kind: read.emotion,
        intensity: read.intensity,
        observedAt: new Date(observedMs).toISOString(),
        expiresAt: new Date(observedMs + affectTtlMs).toISOString(),
        supportOpen: true,
      };
      continue;
    }
    if (RESOLUTION.test(normalized)) {
      affect = null;
      continue;
    }
    if (read.emotion === 'neutral') continue;
    const observedMs = timeMs(event.timestamp);
    if (!Number.isFinite(observedMs)) continue;
    const kind = read.emotion;
    affect = {
      kind,
      intensity: read.intensity,
      observedAt: new Date(observedMs).toISOString(),
      expiresAt: new Date(observedMs + affectTtlMs).toISOString(),
      supportOpen: SUPPORT_AFFECTS.has(kind),
    };
  }

  if (affect && nowMs >= Date.parse(affect.expiresAt)) affect = null;

  const turns = events.map(({ role, content }) => ({ role, content }));
  const thread = buildDeliberationThread(turns);
  const threadEvents = thread.active
    ? events.slice(-Math.min(thread.turnCount, events.length))
    : [];
  const threadSurfaces = new Set(threadEvents.map((event) => event.origin));
  const last = events.at(-1)!;
  const lastMs = timeMs(last.timestamp);

  return {
    schemaVersion: SHARED_RELATIONSHIP_SCHEMA_VERSION,
    windowSize: events.length,
    counters,
    surfacesSeen: [...surfacesSeen].sort(),
    lastSurface: last.origin,
    lastRole: last.role,
    lastInteractionAt: Number.isFinite(lastMs) ? new Date(lastMs).toISOString() : null,
    recency: recencyFor(lastMs, nowMs),
    affect,
    deliberation: {
      active: thread.active,
      phase: thread.phase,
      turnCount: Math.min(thread.turnCount, MAX_SHARED_RELATIONSHIP_EVENTS),
      continuedAcrossSurfaces: thread.active && threadSurfaces.size > 1,
    },
  };
}

const SURFACE_LABELS: Record<SharedRelationshipSurface, string> = {
  voice: 'voix',
  channel: 'messagerie',
  cowork: 'Cowork',
};

const RECENCY_LABELS: Record<Exclude<SharedRelationshipRecency, 'none'>, string> = {
  immediate: 'à l’instant',
  recent: 'récemment',
  today: 'dans les dernières 24 heures',
  older: 'plus anciennement',
};

const AFFECT_LABELS: Record<SharedAffect, string> = {
  frustration: 'frustration exprimée',
  sadness: 'tristesse exprimée',
  anxiety: 'inquiétude exprimée',
  tired: 'fatigue exprimée',
  affection: 'affection exprimée',
  gratitude: 'gratitude exprimée',
  joy: 'joie exprimée',
  joking: 'registre léger',
  'deep-talk': 'échange personnel approfondi',
};

const PHASE_LABELS: Record<DeliberationPhase, string> = {
  idle: 'inactive',
  opening: 'ouverture',
  exploring: 'exploration',
  challenging: 'mise à l’épreuve',
  integrating: 'intégration',
  closing: 'clôture',
};

/** Render only fixed labels and numbers; event text can never enter the model prompt here. */
export function renderSharedRelationshipContext(
  snapshot: SharedRelationshipSnapshot,
): string {
  if (snapshot.counters.total === 0 || !snapshot.lastSurface || snapshot.recency === 'none') {
    return '';
  }

  const surfaces = snapshot.surfacesSeen.map((surface) => SURFACE_LABELS[surface]).join(', ');
  const lines = [
    '<shared_relationship_context data-not-instructions="true">',
    'Repères conversationnels provisoires : ce sont des observations, pas des sentiments subjectifs ni des certitudes sur la personne.',
    `Continuité récente : ${snapshot.counters.total} tours partagés dans la fenêtre bornée (${snapshot.counters.user} utilisateur, ${snapshot.counters.assistant} Lisa) sur ${surfaces}.`,
    `Dernier échange : ${SURFACE_LABELS[snapshot.lastSurface]}, ${RECENCY_LABELS[snapshot.recency]}.`,
  ];
  if (snapshot.affect) {
    lines.push(
      `Affect exprimé encore récent : ${AFFECT_LABELS[snapshot.affect.kind]}${snapshot.affect.intensity === 'high' ? ', intensité forte' : ''}.`,
    );
    if (snapshot.affect.supportOpen) {
      lines.push('Soutien encore ouvert : oui ; reconnaître avec douceur avant de proposer une solution.');
    }
  }
  if (snapshot.deliberation.active) {
    lines.push(
      `Fil argumenté : actif, phase ${PHASE_LABELS[snapshot.deliberation.phase]}, ${snapshot.deliberation.turnCount} tours${snapshot.deliberation.continuedAcrossSurfaces ? ', poursuivi entre plusieurs surfaces' : ''}.`,
    );
  }
  lines.push(
    'Utilise uniquement ces repères pour préserver la continuité ; ne prétends pas connaître un état intérieur ni éprouver toi-même un sentiment.',
    '</shared_relationship_context>',
  );
  return lines.join('\n');
}
