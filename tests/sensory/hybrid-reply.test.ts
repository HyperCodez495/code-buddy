import { describe, it, expect } from 'vitest';
import {
  isSubstantiveQuery,
  buildContextPreamble,
  makeHybridReply,
  type HybridTurn,
} from '../../src/sensory/hybrid-reply.js';

describe('hybrid reply — intent classifier (isSubstantiveQuery)', () => {
  it('keeps social / emotional small talk as chitchat (false)', () => {
    for (const s of [
      'ça va ?',
      'coucou Lisa',
      'je t’aime',
      'tu vas bien ?',
      'merci beaucoup',
      'bonne nuit',
      'comment vas-tu',
      'tu me manques',
    ]) {
      expect(isSubstantiveQuery(s), s).toBe(false);
    }
  });

  it('routes commands, technical questions, and interrogatives to the agent (true)', () => {
    for (const s of [
      'vérifie les logs du service',
      'corrige le bug de la boucle vocale',
      'le build est vert ?',
      'et l’autre fichier ?',
      'pourquoi le serveur a planté',
      'combien de tests passent',
      'lance le diagnostic',
      'montre-moi le commit',
    ]) {
      expect(isSubstantiveQuery(s), s).toBe(true);
    }
  });

  it('routes explicit help requests to the grounded agent (true)', () => {
    for (const s of [
      'aide-moi',
      'aide-moi à débugger ça',
      "j'ai besoin d'aide",
      'aidez-moi',
      'au secours',
    ]) {
      expect(isSubstantiveQuery(s), s).toBe(true);
    }
    // …but gratitude for help stays warm chitchat (social wins).
    expect(isSubstantiveQuery('merci pour ton aide')).toBe(false);
  });

  it('survives accent loss from STT (ça → ca)', () => {
    expect(isSubstantiveQuery('ca va')).toBe(false);
    expect(isSubstantiveQuery('verifie le service')).toBe(true);
  });

  it('treats a long utterance as a real request', () => {
    expect(isSubstantiveQuery('je voudrais que tu regardes pour moi le mode vocal en détail')).toBe(true);
  });

  it('empty input is not substantive', () => {
    expect(isSubstantiveQuery('   ')).toBe(false);
  });
});

describe('hybrid reply — context preamble', () => {
  it('is empty with no history', () => {
    expect(buildContextPreamble([])).toBe('');
  });
  it('renders the last two exchanges with speaker labels', () => {
    const h: HybridTurn[] = [
      { role: 'user', content: 'regarde le fichier A' },
      { role: 'assistant', content: 'le fichier A va bien' },
    ];
    const p = buildContextPreamble(h);
    expect(p).toContain('Patrice: regarde le fichier A');
    expect(p).toContain('Toi: le fichier A va bien');
  });
});

describe('hybrid reply — routing & memory', () => {
  function harness() {
    const calls: string[] = [];
    const reply = makeHybridReply({
      fastReply: (h) => (/^bonjour/i.test(h) ? 'Coucou Patrice.' : null),
      chitchat: async (h, hist) => {
        calls.push(`chitchat:${h}:hist=${hist.length}`);
        return `chit(${h})`;
      },
      agentReply: async (h) => {
        calls.push(`agent:${h}`);
        return `ground(${h})`;
      },
    });
    return { reply, calls };
  }

  it('phatic match short-circuits to the fast warm line (no agent, no chitchat)', async () => {
    const { reply, calls } = harness();
    expect(await reply('bonjour')).toBe('Coucou Patrice.');
    expect(calls).toEqual([]);
  });

  it('small talk goes to chitchat; a command goes to the grounded agent', async () => {
    const { reply, calls } = harness();
    expect(await reply('je t’aime')).toBe('chit(je t’aime)');
    // Substantive → grounded agent. (The agent input also carries a context preamble once
    // there is history; the precise threading is asserted in the memory test below.)
    expect(await reply('vérifie les logs')).toContain('vérifie les logs');
    expect(calls.some((c) => c.startsWith('chitchat:je'))).toBe(true);
    expect(calls.some((c) => c.startsWith('agent:'))).toBe(true);
  });

  it('feeds prior exchanges back: chitchat gets history, the agent gets a context preamble', async () => {
    const { reply, calls } = harness();
    await reply('je t’aime'); // records one exchange
    await reply('et le fichier ?'); // substantive → agent, must carry context
    const agentCall = calls.find((c) => c.startsWith('agent:'))!;
    expect(agentCall).toContain('Contexte récent');
    expect(agentCall).toContain('Demande actuelle : et le fichier ?');
    // a later chitchat sees accumulated history
    await reply('merci'); // not phatic in this harness (fastReply only matches bonjour)
    const lastChit = calls.filter((c) => c.startsWith('chitchat:')).pop()!;
    expect(lastChit).toContain('hist='); // history was passed in
    expect(lastChit.endsWith('hist=0')).toBe(false);
  });

  it('never-throws: an agent failure becomes silence (empty string)', async () => {
    const reply = makeHybridReply({
      fastReply: () => null,
      chitchat: async () => 'x',
      agentReply: async () => {
        throw new Error('boom');
      },
    });
    expect(await reply('vérifie les logs')).toBe('');
  });
});
