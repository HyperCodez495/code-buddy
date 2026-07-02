/**
 * Phase 2 of the interactions refonte: rebranching the orphaned engines onto the voice path.
 *
 * `buildRelationalContext` composes (a) accepted user-model facts, (b) Lisa's mood/traits summary,
 * (c) the live camera presence — the two rich engines that were built but never read by any
 * sensory/companion surface. Tests prove: composition + order, best-effort (a throwing source is
 * skipped, never crashes the voice loop), and — through the REAL user-model privacy screen, no mock
 * — that only accepted facts surface and a sensitive fact is refused at write time so it can't leak.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildRelationalContext } from '../../src/companion/relational-context.js';
import { getUserModel, resetUserModels } from '../../src/memory/user-model.js';
import { buildLlmArrivalOpener } from '../../src/sensory/arrival-opener.js';

describe('buildRelationalContext — composition', () => {
  it('composes facts → recent episode → personality → presence, in order', async () => {
    const ctx = await buildRelationalContext({
      factsBlock: () => '<user_model>\n- aime TypeScript\n</user_model>',
      episodeBlock: async () => 'Récemment, on a parlé de : le bug du train.',
      personalitySummary: () => 'Humeur actuelle : joyeuse (72/100). Lien : complice.',
      presenceBlock: async () => '<presence>\n  Patrice est devant la caméra.\n</presence>',
    });
    const iFacts = ctx.indexOf('user_model');
    const iEp = ctx.indexOf('recent_episode');
    const iState = ctx.indexOf('lisa_state');
    const iPres = ctx.indexOf('presence');
    expect(iFacts).toBeGreaterThanOrEqual(0);
    expect(iEp).toBeGreaterThan(iFacts);
    expect(iState).toBeGreaterThan(iEp);
    expect(iPres).toBeGreaterThan(iState);
    expect(ctx).toContain('le bug du train');
  });

  it('wraps a recent episode in <recent_episode>, omits it when there is none', async () => {
    const withEp = await buildRelationalContext({
      includeFacts: false,
      includePersonality: false,
      includePresence: false,
      episodeBlock: async () => 'Récemment, on a parlé de : la refonte.',
    });
    expect(withEp).toBe('<recent_episode>\nRécemment, on a parlé de : la refonte.\n</recent_episode>');

    const noEp = await buildRelationalContext({
      includeFacts: false,
      includePersonality: false,
      includePresence: false,
      episodeBlock: async () => null,
    });
    expect(noEp).toBe('');
  });

  it('wraps the personality summary in <lisa_state>', async () => {
    const ctx = await buildRelationalContext({
      includeFacts: false,
      includeEpisode: false,
      includePresence: false,
      personalitySummary: () => 'Humeur actuelle : sereine (60/100). Lien : familier.',
    });
    expect(ctx).toBe('<lisa_state>\nHumeur actuelle : sereine (60/100). Lien : familier.\n</lisa_state>');
  });

  it('is best-effort: a throwing source contributes nothing and the rest survives', async () => {
    const ctx = await buildRelationalContext({
      factsBlock: () => {
        throw new Error('boom');
      },
      episodeBlock: async () => {
        throw new Error('boom-ep');
      },
      personalitySummary: () => 'Humeur actuelle : lasse (10/100). Lien : nouveau.',
      presenceBlock: async () => {
        throw new Error('boom2');
      },
    });
    expect(ctx).toContain('lasse (10/100)');
    expect(ctx).not.toContain('user_model');
    expect(ctx).not.toContain('recent_episode');
    expect(ctx).not.toContain('presence');
  });

  it('returns empty string when every source is empty', async () => {
    const ctx = await buildRelationalContext({
      factsBlock: () => null,
      episodeBlock: async () => null,
      personalitySummary: () => '',
      presenceBlock: async () => '',
    });
    expect(ctx).toBe('');
  });

  it('respects include flags', async () => {
    const ctx = await buildRelationalContext({
      includeFacts: false,
      includeEpisode: false,
      includePersonality: false,
      presenceBlock: async () => '<presence>seul</presence>',
    });
    expect(ctx).toBe('<presence>seul</presence>');
  });
});

describe('buildRelationalContext — real user-model (accepted-only + privacy, no mock)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'relctx-'));
    resetUserModels();
  });
  afterEach(() => {
    resetUserModels();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('surfaces only ACCEPTED facts, and a sensitive fact is refused at write so it can never leak', async () => {
    const model = getUserModel(tmp);
    // A proposed (pending) observation is NOT in the active model yet.
    const { observation } = model.observe({ kind: 'preference', content: 'prefere TypeScript strict, pas de mocks' });
    const before = await buildRelationalContext({ cwd: tmp, includePersonality: false, includePresence: false, includeEpisode: false });
    expect(before).not.toContain('TypeScript strict');

    // Human acceptance → now it surfaces.
    model.accept(observation.id, { reviewedBy: 'patrice' });
    const after = await buildRelationalContext({ cwd: tmp, includePersonality: false, includePresence: false, includeEpisode: false });
    expect(after).toContain('TypeScript strict');

    // A sensitive fact is refused by the real privacy screen at WRITE time → never enters the model.
    expect(() => model.observe({ kind: 'trait', content: 'his salary is 400 eur per day' })).toThrow();
    const stillClean = await buildRelationalContext({ cwd: tmp, includePersonality: false, includePresence: false, includeEpisode: false });
    expect(stillClean).not.toMatch(/salary|400/i);
  });
});

describe('buildLlmArrivalOpener — injects relationalContext into the system prompt', () => {
  it('passes the relational context to the LLM so it can reference the relationship', async () => {
    let capturedSystem = '';
    const line = await buildLlmArrivalOpener({
      now: Date.parse('2026-07-02T09:00:00'),
      lastSeenAt: null,
      relationalContext: '<lisa_state>\nHumeur actuelle : joyeuse (72/100). Lien : complice.\n</lisa_state>',
      chat: async (messages) => {
        capturedSystem = messages.find((m) => m.role === 'system')?.content ?? '';
        return 'Content de te revoir, on est bien tous les deux.';
      },
    });
    expect(line).toBe('Content de te revoir, on est bien tous les deux.');
    expect(capturedSystem).toContain('joyeuse (72/100)');
    expect(capturedSystem).toContain('Lien : complice');
  });

  it('omits the relational line entirely when none is supplied', async () => {
    let capturedSystem = '';
    await buildLlmArrivalOpener({
      now: Date.parse('2026-07-02T09:00:00'),
      lastSeenAt: null,
      chat: async (messages) => {
        capturedSystem = messages.find((m) => m.role === 'system')?.content ?? '';
        return 'Bonjour !';
      },
    });
    expect(capturedSystem).not.toContain('Ce que tu sais de lui');
  });
});
