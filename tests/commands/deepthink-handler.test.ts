import { beforeEach, describe, expect, it } from 'vitest';
import { resetExtendedThinking, getExtendedThinking } from '../../src/agent/extended-thinking.js';
import { resetOperatingModeManager, getOperatingModeManager } from '../../src/agent/operating-modes.js';
import { handleDeepthink } from '../../src/commands/handlers/deepthink-handler.js';

describe('handleDeepthink', () => {
  beforeEach(() => {
    resetExtendedThinking();
    resetOperatingModeManager();
  });

  it('returns usage without passing to AI when args are empty', async () => {
    const result = await handleDeepthink([]);

    expect(result.handled).toBe(true);
    expect(result.passToAI).not.toBe(true);
    expect(result.entry?.content).toContain('Usage: /deepthink <question>');
  });

  it('activates plan mode and builds a deep reasoning prompt with the question and expected sections', async () => {
    const result = await handleDeepthink(['Comment', 'améliorer', 'la', 'mémoire', 'projet', '?']);

    expect(result.handled).toBe(true);
    expect(result.passToAI).toBe(true);
    expect(result.prompt).toContain('Comment améliorer la mémoire projet ?');
    expect(result.prompt).toContain('Mode plan actif');
    expect(result.prompt).toContain('lecture seule');
    expect(result.prompt).toContain('Reformulation du problème');
    expect(result.prompt).toContain('Trois angles d\'attaque indépendants');
    expect(result.prompt).toContain('Confrontation croisée');
    expect(result.prompt).toContain('Risques et inconnues');
    expect(result.prompt).toContain('Recommandation finale avec critères de décision');
    expect(result.prompt).toContain('Plan d\'exécution étape par étape');
    expect(getOperatingModeManager().getMode()).toBe('plan');
  });

  it('applies xhigh extended thinking without throwing', async () => {
    await expect(handleDeepthink(['Analyse', 'cette', 'architecture'])).resolves.toMatchObject({
      handled: true,
      passToAI: true,
    });

    expect(getExtendedThinking().isEnabled()).toBe(true);
    expect(getExtendedThinking().getTokenBudget()).toBe(16384);
  });
});
