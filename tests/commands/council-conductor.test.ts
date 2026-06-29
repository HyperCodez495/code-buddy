import { describe, expect, it } from 'vitest';
import {
  assignCouncilRolesToCandidates,
  buildCouncilConductorPlan,
  buildCouncilPrompt,
  buildCouncilSynthesisPrompt,
  buildCouncilVerificationHint,
  computeCouncilDecisionSignals,
  gatherPeerAnswers,
  shouldRecordCouncilLearning,
  type CouncilPeer,
  type RankedCandidate,
} from '../../src/commands/council.js';

function peer(id: string, seen: string[]): CouncilPeer {
  return {
    id,
    listener: {
      request: async (_method, params) => {
        seen.push(String(params?.prompt ?? ''));
        return { text: `answer from ${id}`, modelRequested: 'peer-model' };
      },
    },
  };
}

function candidate(model: string, hist = 0): RankedCandidate {
  return {
    c: {
      provider: model,
      model,
      apiKey: 'test-key',
      costInputUsdPerMtok: 0,
    },
    strengths: ['reasoning'],
    score: 1,
    hist,
  };
}

describe('council conductor', () => {
  it('uses complementary roles for complex council tasks', () => {
    const plan = buildCouncilConductorPlan(
      'Fais un audit complet de cette architecture et propose une modernisation',
      'code',
      3,
    );

    expect(plan.mode).toBe('collective');
    expect(plan.roles.map(role => role.id)).toEqual(['architect', 'implementer', 'reviewer']);
  });

  it('falls back to direct fan-out for simple or disabled tasks', () => {
    const simple = buildCouncilConductorPlan('bonjour', 'general', 3);
    const disabled = buildCouncilConductorPlan('audit complexe', 'code', 3, false);

    expect(simple.mode).toBe('direct');
    expect(disabled.mode).toBe('direct');
    expect(buildCouncilPrompt('bonjour', simple, 0)).toBe('bonjour');
  });

  it('builds role-specific prompts that preserve the original task', () => {
    const task = 'Compare REST et GraphQL pour ce projet';
    const plan = buildCouncilConductorPlan(task, 'reasoning', 2);
    const prompt = buildCouncilPrompt(task, plan, 1);

    expect(prompt).toContain('Code Buddy Council');
    expect(prompt).toContain('Skeptic');
    expect(prompt).toContain(task);
    expect(prompt).toContain('assumptions');
  });

  it('can specialize fleet peer prompts without breaking peer answer collection', async () => {
    const seen: string[] = [];
    const peers = [peer('a', seen), peer('b', seen)];
    const plan = buildCouncilConductorPlan('audite ce module', 'code', 4);

    const { answers, errors } = await gatherPeerAnswers('audite ce module', peers, 1000, {
      promptForPeer: (_p, index) => buildCouncilPrompt('audite ce module', plan, index + 2),
      roleForPeer: (_p, index) => plan.roles[index + 2],
    });

    expect(errors).toEqual([]);
    expect(answers.map(answer => answer.modelId)).toEqual(['a', 'b']);
    expect(seen[0]).toContain('Reviewer');
    expect(seen[1]).toContain('Verifier');
    expect(answers.map(answer => answer.role?.id)).toEqual(['reviewer', 'verifier']);
  });

  it('builds a synthesis prompt from role-specialized answers and judge scores', () => {
    const signals = computeCouncilDecisionSignals([0.8, 0.9], 1, 0.42);
    const prompt = buildCouncilSynthesisPrompt(
      'Ameliore council',
      [
        {
          modelName: 'a',
          roleLabel: 'Architect',
          score: 0.8,
          winner: false,
          content: 'Add roles.',
        },
        {
          modelName: 'b',
          roleLabel: 'Verifier',
          score: 0.9,
          winner: true,
          content: 'Add tests.',
        },
      ],
      0.42,
      signals,
    );

    expect(prompt.system).toContain('synthesizer');
    expect(prompt.user).toContain('role: Architect');
    expect(prompt.user).toContain('role: Verifier');
    expect(prompt.user).toContain('judge reference winner');
    expect(prompt.user).toContain('Lexical agreement signal: 42%');
    expect(prompt.user).toContain('Decision confidence: low');
    expect(prompt.user).toContain('Role-specialized inputs');
  });

  it('computes decision confidence from judge margin and agreement', () => {
    const high = computeCouncilDecisionSignals([0.94, 0.2, 0.1], 0, 0.82);
    const low = computeCouncilDecisionSignals([0.61, 0.55, 0.4], 0, 0.2);

    expect(high.confidence).toBe('high');
    expect(high.margin).toBeCloseTo(0.74, 5);
    expect(low.confidence).toBe('low');
    expect(low.reasons).toEqual(expect.arrayContaining(['narrow judge margin', 'low answer agreement']));
    expect(buildCouncilVerificationHint(low, 'code')).toContain('plan de tests');
    expect(buildCouncilVerificationHint(high, 'code')).toBeUndefined();
  });

  it('records scoreboard learning only for reliable non-low-confidence judge verdicts', () => {
    expect(shouldRecordCouncilLearning(true, 'high')).toBe(true);
    expect(shouldRecordCouncilLearning(true, 'medium')).toBe(true);
    expect(shouldRecordCouncilLearning(true, 'low')).toBe(false);
    expect(shouldRecordCouncilLearning(false, 'high')).toBe(false);
  });

  it('assigns picked models to roles using role-specific scoreboard history', () => {
    const plan = buildCouncilConductorPlan('audite ce module', 'code', 3);
    const picked = [candidate('model-a'), candidate('model-b'), candidate('model-c')];
    const assigned = assignCouncilRolesToCandidates(picked, plan.roles, 'code', {
      roleScore: (_taskType, role, model) => {
        if (role === 'architect' && model === 'model-b') return 0.9;
        if (role === 'implementer' && model === 'model-c') return 0.8;
        if (role === 'reviewer' && model === 'model-a') return 0.7;
        return 0;
      },
    });

    expect(assigned.map((entry) => entry.c.model)).toEqual(['model-b', 'model-c', 'model-a']);
  });
});
