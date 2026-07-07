/**
 * Structured-fact reconciliation for the CKG — Memory-Kernel discipline
 * (jarvis-OS `ingest.py`, clean-room concepts).
 *
 * A structured fact is a `(subject, predicate, object, category)` claim. This
 * module is PURE: it owns the closed vocabulary, normalization, the
 * deterministic match key, category-derived decay, and the reconciliation
 * verdict. The CKG wires it to its existing bi-temporal ledger — the elegant
 * part is that by making the CKG node `name = matchKey(subject,predicate,
 * category)` and `text = canonicalObject`, the ledger's own machinery gives us
 * reinforcement-without-duplication (same key + same object → mentions++) and
 * supersession (same key + new object → bi-temporal supersede) for free. This
 * module adds what the ledger lacks: a vocabulary gate, canonical forms, and
 * retention scoring that decays at a rate DERIVED FROM the category.
 */

/** Closed predicate vocabulary — anything else is quarantined (never active). */
export const FACT_PREDICATES = [
  'is', 'has', 'prefers', 'dislikes', 'uses', 'works_on', 'targets', 'plans',
  'believes', 'needs', 'struggles_with', 'decided', 'changed', 'values',
  'communicates_as', 'requires_validation_for',
] as const;
export type FactPredicate = (typeof FACT_PREDICATES)[number];

/** Closed category vocabulary. */
export const FACT_CATEGORIES = [
  'identity', 'preference', 'project', 'goal', 'habit', 'constraint', 'belief',
  'relationship', 'tool', 'persona', 'decision', 'health_fitness', 'work_style',
  'memory_correction',
] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

const PREDICATE_SET = new Set<string>(FACT_PREDICATES);
const CATEGORY_SET = new Set<string>(FACT_CATEGORIES);

/**
 * Decay policy DERIVED from the category (not a uniform TTL). identity/decision/
 * memory_correction never fade (a decision can be superseded but doesn't lapse
 * passively); goals fade fastest. Half-lives in days; `null` = immortal.
 */
export type DecayPolicy = 'none' | 'very_slow' | 'slow' | 'medium' | 'fast';

const CATEGORY_DECAY: Record<FactCategory, DecayPolicy> = {
  identity: 'none',
  decision: 'none',
  memory_correction: 'none',
  constraint: 'slow',
  belief: 'slow',
  relationship: 'slow',
  persona: 'slow',
  work_style: 'slow',
  preference: 'medium',
  project: 'medium',
  habit: 'medium',
  tool: 'medium',
  health_fitness: 'medium',
  goal: 'fast',
};

const DECAY_HALFLIFE_DAYS: Record<DecayPolicy, number | null> = {
  none: null,
  very_slow: 730,
  slow: 365,
  medium: 90,
  fast: 14,
};

/**
 * Categories whose object is a SINGLE canonical value — a different object
 * means the fact CHANGED (supersede), not that two values coexist. Elsewhere
 * (e.g. multiple preferences), differing objects are allowed to coexist.
 */
const STABLE_CATEGORIES = new Set<FactCategory>([
  'identity', 'goal', 'decision', 'constraint', 'persona',
]);

export function decayPolicyFor(category: FactCategory): DecayPolicy {
  return CATEGORY_DECAY[category];
}

/** Retention 0..1 under the Ebbinghaus curve for this category's decay. Immortal ⇒ 1. */
export function factRetention(category: FactCategory, ageDays: number): number {
  const halfLife = DECAY_HALFLIFE_DAYS[decayPolicyFor(category)];
  if (halfLife === null) return 1;
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 1;
  return Math.pow(0.5, ageDays / halfLife);
}

export function isKnownPredicate(predicate: string): predicate is FactPredicate {
  return PREDICATE_SET.has(predicate);
}

export function isKnownCategory(category: string): category is FactCategory {
  return CATEGORY_SET.has(category);
}

export function isStableCategory(category: FactCategory): boolean {
  return STABLE_CATEGORIES.has(category);
}

/** Normalize a fact component: lowercase, strip accents, collapse whitespace. */
export function normalizeFactPart(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface StructuredFact {
  subject: string;
  predicate: string;
  object: string;
  category: string;
}

/**
 * Deterministic identity key of a fact = `(subject, predicate, category)`
 * normalized. Two facts with the same key are THE SAME CLAIM about the same
 * thing — reinforced or superseded, never duplicated. The OBJECT is
 * deliberately excluded (a new object on the same key is a change).
 */
export function factMatchKey(fact: Pick<StructuredFact, 'subject' | 'predicate' | 'category'>): string {
  return [
    normalizeFactPart(fact.subject),
    normalizeFactPart(fact.predicate),
    normalizeFactPart(fact.category),
  ].join('|');
}

/** Canonical human-readable object (the CKG node text for this fact). */
export function canonicalObject(fact: Pick<StructuredFact, 'object'>): string {
  return normalizeFactPart(fact.object);
}

export type FactVerdict =
  | { kind: 'quarantine'; reasons: string[] }
  | { kind: 'new' }
  | { kind: 'confirm' }
  | { kind: 'supersede'; previousObject: string }
  | { kind: 'coexist' };

/**
 * Decide what to do with an incoming fact given the object of an EXISTING
 * active fact sharing its match key (or null if none). Pure, deterministic,
 * zero-LLM — the arbiter LLM of the original design is deferred to the caller
 * for the ambiguous "same key, different object, non-stable category" case;
 * here that resolves conservatively to `coexist`.
 */
export function reconcileFact(fact: StructuredFact, existingObject: string | null): FactVerdict {
  const reasons: string[] = [];
  if (!fact.subject.trim()) reasons.push('empty subject');
  if (!fact.object.trim()) reasons.push('empty object');
  if (!isKnownPredicate(normalizeFactPart(fact.predicate))) {
    reasons.push(`predicate "${fact.predicate}" not in closed vocabulary`);
  }
  if (!isKnownCategory(normalizeFactPart(fact.category))) {
    reasons.push(`category "${fact.category}" not in closed vocabulary`);
  }
  if (reasons.length > 0) return { kind: 'quarantine', reasons };

  const incoming = canonicalObject(fact);
  if (existingObject === null) return { kind: 'new' };
  if (normalizeFactPart(existingObject) === incoming) return { kind: 'confirm' };

  // Same key, different object.
  const category = normalizeFactPart(fact.category) as FactCategory;
  return isStableCategory(category)
    ? { kind: 'supersede', previousObject: existingObject }
    : { kind: 'coexist' };
}
