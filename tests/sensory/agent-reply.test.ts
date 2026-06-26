import { describe, it, expect, beforeEach } from 'vitest';
import { makeAgentReply } from '../../src/sensory/agent-reply.js';
import {
  getPermissionModeManager,
  resetPermissionModeManager,
} from '../../src/security/permission-modes.js';

describe('agent-reply — spoken instruction → full agent turn', () => {
  beforeEach(() => resetPermissionModeManager());

  it('runs the turn, condenses the output, returns the spoken summary', async () => {
    const seen: string[] = [];
    const reply = makeAgentReply({
      agentRunner: async (t) => {
        seen.push(`turn:${t}`);
        return 'Le projet compte 27000 tests et la boucle vocale est fermée. (long markdown…)';
      },
      summarize: async (out, t) => {
        seen.push(`sum:${t}`);
        expect(out).toContain('27000');
        return 'Tout va bien, la boucle vocale est prête.';
      },
    });
    const spoken = await reply('où en est le projet ?');
    expect(spoken).toBe('Tout va bien, la boucle vocale est prête.');
    expect(seen).toEqual(['turn:où en est le projet ?', 'sum:où en est le projet ?']);
  });

  it('never throws — a failed turn becomes a spoken apology', async () => {
    const reply = makeAgentReply({
      apology: 'OOPS',
      agentRunner: async () => {
        throw new Error('model down');
      },
      summarize: async () => 'unused',
    });
    await expect(reply('fais un truc')).resolves.toBe('OOPS');
  });

  it('speaks a short confirmation when the turn acted but produced no text', async () => {
    const reply = makeAgentReply({
      agentRunner: async () => '   ',
      summarize: async () => 'unused',
    });
    await expect(reply('lance les tests')).resolves.toBe("C'est fait.");
  });

  it('falls back to a truncated first line when summarize fails', async () => {
    const reply = makeAgentReply({
      agentRunner: async () => 'Première ligne du résultat.\nDétails markdown ignorés.',
      summarize: async () => {
        throw new Error('summarizer down');
      },
    });
    await expect(reply('résume')).resolves.toBe('Première ligne du résultat.');
  });

  it('applies the SAFE default posture (plan = read-only) on first turn', async () => {
    const reply = makeAgentReply({ agentRunner: async () => 'ok', summarize: async () => 'ok' });
    await reply('lis le fichier');
    const pm = getPermissionModeManager();
    expect(pm.getMode()).toBe('plan');
    // plan denies writes, allows reads — the actual guardrail lever.
    expect(pm.checkPermission('edit', 'edit_file').allowed).toBe(false);
    expect(pm.checkPermission('read', 'read_file').allowed).toBe(true);
  });

  it('honors an explicit posture (dontAsk lets the agent act)', async () => {
    const reply = makeAgentReply({
      permissionMode: 'dontAsk',
      agentRunner: async () => 'ok',
      summarize: async () => 'ok',
    });
    await reply('édite le fichier');
    expect(getPermissionModeManager().getMode()).toBe('dontAsk');
  });

  it('plays the ack BEFORE the (slow) turn', async () => {
    const order: string[] = [];
    const reply = makeAgentReply({
      ack: async () => {
        order.push('ack');
      },
      agentRunner: async () => {
        order.push('turn');
        return 'done';
      },
      summarize: async () => 'résumé',
    });
    await reply('fais X');
    expect(order).toEqual(['ack', 'turn']);
  });
});
