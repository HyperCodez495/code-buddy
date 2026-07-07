/**
 * Structured-fact reconciliation — pure module + CKG integration on a real tmp
 * ledger (no mocks; recallFacts uses keyword recall, no embeddings needed).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  canonicalObject,
  decayPolicyFor,
  factMatchKey,
  factRetention,
  isStableCategory,
  reconcileFact,
  type StructuredFact,
} from '../../src/memory/ckg-fact-reconciliation.js';
import { CollectiveKnowledgeGraph } from '../../src/memory/collective-knowledge-graph.js';

describe('ckg-fact-reconciliation (pure)', () => {
  it('builds a normalized, object-independent match key', () => {
    const a = factMatchKey({ subject: 'Barth', predicate: 'targets', category: 'goal' });
    const b = factMatchKey({ subject: 'BARTH ', predicate: 'targets', category: 'goal' });
    expect(a).toBe('barth|targets|goal');
    expect(b).toBe(a); // object excluded, accents/case/space normalized
  });

  it('derives decay from the category (identity immortal, goal fast)', () => {
    expect(decayPolicyFor('identity')).toBe('none');
    expect(decayPolicyFor('decision')).toBe('none');
    expect(decayPolicyFor('goal')).toBe('fast');
    expect(factRetention('identity', 10_000)).toBe(1); // never fades
    expect(factRetention('goal', 14)).toBeCloseTo(0.5, 2); // half-life 14d
    expect(factRetention('goal', 28)).toBeCloseTo(0.25, 2);
  });

  const fact = (o: Partial<StructuredFact>): StructuredFact => ({
    subject: 'barth',
    predicate: 'targets',
    object: 'marathon-sub-3h',
    category: 'goal',
    ...o,
  });

  it('quarantines out-of-vocabulary predicate/category', () => {
    expect(reconcileFact(fact({ predicate: 'wishes' }), null)).toEqual({
      kind: 'quarantine',
      reasons: [expect.stringContaining('predicate')],
    });
    expect(reconcileFact(fact({ category: 'mood' }), null).kind).toBe('quarantine');
    expect(reconcileFact(fact({ object: '' }), null).kind).toBe('quarantine');
  });

  it('confirms an identical object, supersedes a changed stable-category object', () => {
    expect(reconcileFact(fact({}), null)).toEqual({ kind: 'new' });
    expect(reconcileFact(fact({}), 'marathon-sub-3h')).toEqual({ kind: 'confirm' });
    // goal is a stable category → a different object means it CHANGED.
    expect(reconcileFact(fact({}), 'marathon-3h10')).toEqual({
      kind: 'supersede',
      previousObject: 'marathon-3h10',
    });
  });

  it('lets non-stable categories coexist on a changed object', () => {
    expect(isStableCategory('preference')).toBe(false);
    const pref = fact({ predicate: 'prefers', category: 'preference', object: 'dark-mode' });
    expect(reconcileFact(pref, 'light-mode')).toEqual({ kind: 'coexist' });
  });

  it('canonicalizes the object', () => {
    expect(canonicalObject({ object: '  Sub-3h  Marathon ' })).toBe('sub-3h marathon');
  });
});

describe('CKG.rememberFact + recallFacts (integration, real ledger)', () => {
  let dir: string;
  let ledgerPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ckg-fact-'));
    ledgerPath = join(dir, 'ckg-ledger.jsonl');
  });
  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it('reinforces without duplicating on a re-asserted fact', () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    const first = ckg.rememberFact({ subject: 'barth', predicate: 'uses', object: 'code buddy', category: 'tool' });
    expect(first.verdict.kind).toBe('new');
    const again = ckg.rememberFact({ subject: 'Barth', predicate: 'uses', object: 'Code Buddy', category: 'tool' });
    expect(again.verdict.kind).toBe('confirm');
    expect(again.stored!.mentions).toBe(2); // reinforced, not a second node
    expect(ckg.getStats().entities).toBe(1);
  });

  it('supersedes a changed goal (bi-temporal), keeping the old version in history', () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    ckg.rememberFact({ subject: 'barth', predicate: 'targets', object: 'marathon 3h10', category: 'goal' });
    const changed = ckg.rememberFact({ subject: 'barth', predicate: 'targets', object: 'marathon sub-3h', category: 'goal' });
    expect(changed.verdict.kind).toBe('supersede');
    const stats = ckg.getStats();
    expect(stats.entities).toBe(1); // one CURRENT goal
    expect(stats.superseded).toBe(1); // the old value archived, never deleted
  });

  it('quarantines an out-of-vocab fact (never enters the active graph)', () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    const r = ckg.rememberFact({ subject: 'barth', predicate: 'enjoys', object: 'hiking', category: 'hobby' });
    expect(r.verdict.kind).toBe('quarantine');
    expect(r.stored).toBeNull();
    expect(ckg.getStats().entities).toBe(0);
  });

  it('recallFacts annotates category + retention and drops faded facts below threshold', () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    ckg.rememberFact({ subject: 'barth', predicate: 'is', object: 'engineer', category: 'identity' });
    const hits = ckg.recallFacts('barth engineer identity', { limit: 5 });
    expect(hits.length).toBe(1);
    expect(hits[0]!.category).toBe('identity');
    expect(hits[0]!.retention).toBe(1); // identity never fades
    // A threshold above 1 drops everything (sanity that the filter is wired).
    expect(ckg.recallFacts('barth engineer identity', { minRetention: 1.1 })).toEqual([]);
  });
});
