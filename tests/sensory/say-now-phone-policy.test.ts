import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const phone = vi.hoisted(() => ({
  sendTelegramVoice: vi.fn(async () => true),
}));

vi.mock('../../src/sensory/alert.js', () => ({
  sendTelegramVoice: phone.sendTelegramVoice,
}));

import { sayNow } from '../../src/sensory/voice-loop.js';

describe('sayNow phone delivery policy', () => {
  const previous = process.env.CODEBUDDY_VOICE_TO_TELEGRAM;

  beforeEach(() => {
    process.env.CODEBUDDY_VOICE_TO_TELEGRAM = 'true';
    phone.sendTelegramVoice.mockClear();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.CODEBUDDY_VOICE_TO_TELEGRAM;
    else process.env.CODEBUDDY_VOICE_TO_TELEGRAM = previous;
  });

  it('suppresses the legacy phone fan-out when another transport owns delivery', async () => {
    await sayNow('Réponse déjà partagée.', {
      phoneDelivery: 'never',
      synth: async () => '',
      play: async () => undefined,
    });

    expect(phone.sendTelegramVoice).not.toHaveBeenCalled();
  });

  it('preserves the environment-controlled phone fan-out by default', async () => {
    await sayNow('Annonce téléphonique.', {
      synth: async () => '',
      play: async () => undefined,
    });

    expect(phone.sendTelegramVoice).toHaveBeenCalledWith('Annonce téléphonique.');
  });
});
