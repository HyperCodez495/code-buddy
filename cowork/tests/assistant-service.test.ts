import { describe, expect, it, vi } from 'vitest';
import { AssistantService } from '../src/main/assistant/assistant-service.js';

describe('AssistantService.playPreview', () => {
  it('returns success only after the core confirms playback', async () => {
    const playVoicePreview = vi.fn(async () => ({
      path: '/tmp/estelle-preview.wav',
      played: true,
    }));
    const service = new AssistantService(async () => ({ playVoicePreview }));

    await expect(service.playPreview(' estelle ', ' Bonjour ')).resolves.toEqual({
      ok: true,
      path: '/tmp/estelle-preview.wav',
    });
    expect(playVoicePreview).toHaveBeenCalledWith('estelle', 'Bonjour');
  });

  it('returns an actionable error when no system player can play the WAV', async () => {
    const service = new AssistantService(async () => ({
      playVoicePreview: vi.fn(async () => ({
        path: '/tmp/estelle-preview.wav',
        played: false,
      })),
    }));

    await expect(service.playPreview('estelle')).resolves.toEqual({
      ok: false,
      error: 'aucun lecteur audio système disponible pour lire l\'aperçu',
    });
  });
});

describe('AssistantService.diagnostics', () => {
  it('returns the raw-free voice runtime snapshot', async () => {
    const snapshot = {
      version: 1 as const,
      updatedAt: '2026-07-15T12:00:00.000Z',
      phase: 'speaking',
      counters: {
        captured: 2,
        accepted: 1,
        spoken: 1,
        suppressed: 1,
        interrupted: 0,
        failed: 0,
      },
      recent: [],
    };
    const service = new AssistantService(async () => ({
      readAssistantVoiceDiagnostics: () => snapshot,
    }));

    await expect(service.diagnostics()).resolves.toEqual({ diagnostics: snapshot });
  });
});
