import { describe, expect, it } from 'vitest';

import {
  assessConversationResponse,
  measureConversationTurnProgression,
} from '../../src/conversation/conversation-quality.js';

const DELIBERATIVE_PROMPT = 'Argumente sur la valeur du libre arbitre et de la responsabilité.';

describe('conversation anti-chatter quality signals', () => {
  it('detects propositional circularity hidden behind causal connectors', () => {
    const assessment = assessConversationResponse(
      DELIBERATIVE_PROMPT,
      'La liberté compte parce qu’elle est importante pour la responsabilité. ' +
        'Donc la liberté est importante parce qu’elle compte pour la responsabilité. ' +
        'Ainsi, la responsabilité compte car l’importance de la liberté la rend importante. ' +
        'En conséquence, la liberté compte parce que son importance compte.'
    );

    expect(assessment.issues).toContain('circular_reasoning');
    expect(assessment.circularityRate).toBeGreaterThanOrEqual(0.5);
    expect(assessment.uniquePropositionCount).toBeLessThan(assessment.propositionCount);
    expect(assessment.passes).toBe(false);
  });

  it('detects connector stuffing even when every sentence uses different nouns', () => {
    const assessment = assessConversationResponse(
      DELIBERATIVE_PROMPT,
      'Cependant, donc et pourtant, une intelligence artificielle agit. ' +
        'Ainsi, mais en revanche, la relation existe. ' +
        'Cela dit, parce que la conscience importe, donc l’éthique demeure.'
    );

    expect(assessment.issues).toContain('connector_stuffing');
    expect(assessment.reasoningLinkCount).toBeGreaterThanOrEqual(6);
    expect(assessment.connectorDensity).toBeGreaterThan(0.1);
    expect(assessment.passes).toBe(false);
  });

  it('does not punish a real position → objection → concession → synthesis progression', () => {
    const assessment = assessConversationResponse(
      DELIBERATIVE_PROMPT,
      'Ma position est que le libre arbitre compte parce qu’il rend la responsabilité intelligible. ' +
        'Cependant, les causes biologiques et sociales limitent réellement la marge de choix. ' +
        'Même si cette objection interdit une liberté absolue, je reconnais qu’une capacité graduelle de révision subsiste. ' +
        'En synthèse, nous pouvons donc défendre une responsabilité proportionnée aux possibilités concrètes de chacun.'
    );

    expect(assessment.deliberationProgressionScore).toBe(1);
    expect(assessment.propositionNoveltyRate).toBeGreaterThanOrEqual(0.75);
    expect(assessment.issues).not.toContain('circular_reasoning');
    expect(assessment.issues).not.toContain('connector_stuffing');
    expect(assessment.passes).toBe(true);
  });

  it('returns only aggregate progression signals for consecutive assistant turns', () => {
    const marker = 'MARQUEUR_VERBATIM_INTERDIT';
    const stalled = measureConversationTurnProgression(
      `La liberté compte parce que la responsabilité est importante ${marker}.`,
      `La responsabilité est importante parce que la liberté compte ${marker}.`
    );
    const progressed = measureConversationTurnProgression(
      'La liberté suppose une capacité de choisir.',
      'Une objection vient des déterminismes sociaux. Une réponse consiste à graduer la responsabilité.'
    );

    expect(stalled.stalled).toBe(true);
    expect(stalled.score).toBeLessThan(0.35);
    expect(progressed.stalled).toBe(false);
    expect(progressed.score).toBeGreaterThan(stalled.score);
    expect(JSON.stringify({ stalled, progressed })).not.toContain(marker);
  });

  it('treats a change of polarity as a real revision rather than a duplicate', () => {
    const revision = measureConversationTurnProgression(
      'Je pense que la mémoire suffit à fonder une identité personnelle.',
      'Je pense maintenant que la mémoire ne suffit pas à fonder une identité personnelle.'
    );
    const assessment = assessConversationResponse(
      'La mémoire suffit-elle à fonder une identité personnelle ?',
      'Ma position initiale est que la mémoire suffit parce qu’elle relie les expériences. ' +
        'Cependant, le cas de la copie montre qu’elle ne suffit pas à identifier l’original. ' +
        'Même si les souvenirs restent importants, je reconnais que la continuité causale compte aussi. ' +
        'En synthèse, la mémoire ne suffit donc pas seule à fonder l’identité.'
    );

    expect(revision.stalled).toBe(false);
    expect(revision.score).toBeGreaterThan(0.35);
    expect(assessment.issues).not.toContain('circular_reasoning');
  });
});
