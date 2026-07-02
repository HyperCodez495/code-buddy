/**
 * Phase 4 of the interactions refonte: emotion-aware tone + anti-repetition, and the trait drift it
 * feeds. Pure detectors/guidance are unit-tested directly; the wiring into the hybrid reply is proven
 * end-to-end through the REAL relationship-state file (env-routed temp, no mocks) — an affectionate
 * utterance actually nudges Lisa's warmth up.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  detectRelationalSignal,
  registerGuidanceForSignal,
  openerKey,
  pushOpener,
  avoidOpenersGuidance,
} from '../../src/companion/reply-augment.js';
import { makeHybridReply } from '../../src/sensory/hybrid-reply.js';
import { loadRelationshipState, personalityOf, DEFAULT_TRAITS } from '../../src/companion/relationship-state.js';

describe('detectRelationalSignal', () => {
  it('classifies the dominant emotional colour', () => {
    expect(detectRelationalSignal("je t'aime Lisa")).toBe('affection');
    expect(detectRelationalSignal('merci beaucoup')).toBe('gratitude');
    expect(detectRelationalSignal('haha tu es marrante')).toBe('joking');
    expect(detectRelationalSignal('honnêtement je me sens seul')).toBe('deep-talk');
    expect(detectRelationalSignal('quelle heure est-il')).toBe('neutral');
  });

  it('is accent-insensitive (STT drops accents)', () => {
    expect(detectRelationalSignal('ca marche pas, je galere')).toBe('frustration');
  });

  it('puts frustration FIRST so care is not missed on a mixed message', () => {
    expect(detectRelationalSignal('merci mais je galère vraiment là')).toBe('frustration');
  });
});

describe('registerGuidanceForSignal', () => {
  it('frustration → the caring playbook (present first, no rushed fix)', () => {
    const g = registerGuidanceForSignal('frustration');
    expect(g).toMatch(/pr[ée]cipite|pr[ée]sence|douceur/i);
  });
  it('neutral → no guidance', () => {
    expect(registerGuidanceForSignal('neutral')).toBe('');
  });
});

describe('opener ring', () => {
  it('openerKey normalizes to the first few words', () => {
    expect(openerKey('Bonne question ! Alors, voyons voir…')).toBe('bonne question alors voyons');
  });
  it('pushOpener dedups and caps', () => {
    let ring: string[] = [];
    ring = pushOpener(ring, 'Bonne question, voyons ça');
    ring = pushOpener(ring, 'Bonne question, voyons ça'); // same opener → dedup
    expect(ring.length).toBe(1);
    for (let i = 0; i < 10; i++) ring = pushOpener(ring, `phrase numero ${i} bla`);
    expect(ring.length).toBeLessThanOrEqual(6);
  });
  it('avoidOpenersGuidance is empty for an empty ring, else names the openers', () => {
    expect(avoidOpenersGuidance([])).toBe('');
    expect(avoidOpenersGuidance(['bonne question alors'])).toContain('bonne question alors');
  });
});

describe('hybrid reply evolves Lisa’s traits per utterance (real state file, opt-in)', () => {
  let tmp: string;
  let statePath: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'replyaug-'));
    statePath = join(tmp, 'relationship-state.json');
    process.env.CODEBUDDY_RELATIONSHIP_STATE_FILE = statePath;
    process.env.CODEBUDDY_COMPANION_RELATIONAL = 'true';
  });
  afterEach(() => {
    delete process.env.CODEBUDDY_RELATIONSHIP_STATE_FILE;
    delete process.env.CODEBUDDY_COMPANION_RELATIONAL;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('an affectionate utterance nudges warmth up; feature-off leaves it untouched', async () => {
    // Injected seams → no model, no network. The evolution runs at the top of the reply, gated.
    const reply = makeHybridReply({
      fastReply: () => 'coucou',
      chitchat: async () => 'coucou',
      agentReply: async () => 'coucou',
      classify: () => false,
    });
    await reply("je t'aime Lisa, tu me manques");
    const warmth = personalityOf(loadRelationshipState(statePath)).traits.warmth;
    expect(warmth).toBeGreaterThan(DEFAULT_TRAITS.warmth);

    // With the flag off, no state is written (default path untouched).
    delete process.env.CODEBUDDY_COMPANION_RELATIONAL;
    const tmp2 = mkdtempSync(join(tmpdir(), 'replyaug2-'));
    const state2 = join(tmp2, 'relationship-state.json');
    process.env.CODEBUDDY_RELATIONSHIP_STATE_FILE = state2;
    try {
      const reply2 = makeHybridReply({ fastReply: () => 'ok', chitchat: async () => 'ok', agentReply: async () => 'ok', classify: () => false });
      await reply2("je t'aime");
      // No file written → load returns the default baseline.
      expect(personalityOf(loadRelationshipState(state2)).traits.warmth).toBe(DEFAULT_TRAITS.warmth);
    } finally {
      rmSync(tmp2, { recursive: true, force: true });
    }
  });
});
