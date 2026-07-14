import { describe, expect, it } from 'vitest';
import {
  deriveVoiceDeliveryProfile,
  voiceDeliveryGuidance,
  voiceRendererDeliveryInstruction,
} from '../../src/sensory/voice-entrainment.js';

describe('voice entrainment', () => {
  it('moves toward a calm human pace without imitating an extreme', () => {
    const profile = deriveVoiceDeliveryProfile(
      'je voudrais prendre le temps de réfléchir avec toi',
      { audioMs: 8_000 },
    );

    expect(profile).toMatchObject({
      pace: 'slow',
      pauseStyle: 'reflective',
      confidence: 'high',
      humanAudioMs: 8_000,
      humanWpm: 68,
      targetWpm: 105,
    });
  });

  it('follows a lively turn only part-way and keeps a safe acoustic bound', () => {
    const profile = deriveVoiceDeliveryProfile(
      'on avance vite maintenant donne moi les trois points essentiels',
      { audioMs: 3_000 },
    );

    expect(profile.pace).toBe('brisk');
    expect(profile.humanWpm).toBe(200);
    expect(profile.targetWpm).toBe(184);
    expect(profile.targetWpm).toBeLessThan(profile.humanWpm!);
  });

  it('does not invent precise WPM from a short interjection or implausible timing', () => {
    expect(deriveVoiceDeliveryProfile('oui', { audioMs: 400 })).toMatchObject({
      pace: 'balanced',
      responseShape: 'compact',
      confidence: 'low',
      humanWordCount: 1,
    });
    expect(deriveVoiceDeliveryProfile('un deux trois', { audioMs: 100 }).humanWpm).toBeUndefined();
  });

  it('uses turn length for oral shape while explicitly preserving intellectual depth', () => {
    const profile = deriveVoiceDeliveryProfile('Pourquoi la conscience existe-t-elle ?', {
      audioMs: 2_400,
    });
    const guidance = voiceDeliveryGuidance(profile);

    expect(profile.responseShape).toBe('compact');
    expect(guidance).toContain('jamais la qualité du fond');
    expect(guidance).toMatch(/analyse, actualité, preuves, nuances ou argumentation philosophique/);
    expect(guidance).toContain('fournis-les complètement');
  });

  it('provides a persona-neutral instruction for expressive renderers', () => {
    const profile = deriveVoiceDeliveryProfile(
      'je développe cette idée tranquillement pour que nous puissions vraiment la comprendre ensemble',
      { audioMs: 7_000 },
    );
    const instruction = voiceRendererDeliveryInstruction(profile);

    expect(instruction).toContain(`${profile.targetWpm} words per minute`);
    expect(instruction).not.toMatch(/Lisa|Patrice|personality/i);
  });
});
