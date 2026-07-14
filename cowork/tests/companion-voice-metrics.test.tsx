// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompanionVoiceMetrics } from '../src/renderer/components/companion/CompanionVoiceMetrics';
import type { CompanionVoiceLoopStats } from '../src/renderer/types';

const VOICE_STATS: CompanionVoiceLoopStats = {
  windowSize: 100,
  hearingCount: 12,
  latest: {
    timestamp: '2026-07-14T13:20:00.000Z',
    resumeAfterPlaybackMs: 420,
    turnTakingKind: 'echo_tail',
    deliveryPace: 'brisk',
    responseShape: 'compact',
    humanWpm: 200,
    targetWpm: 184,
  },
  latency: {
    perceivedResponseMs: {
      count: 12,
      min: 210,
      p50: 480,
      p95: 910,
      max: 1_100,
      avg: 520,
    },
    resumeAfterPlaybackMs: {
      count: 8,
      min: 180,
      p50: 620,
      p95: 1_450,
      max: 1_900,
      avg: 710,
    },
  },
  capture: {},
  delivery: {
    profiledCount: 12,
    measuredRateCount: 9,
    humanWpm: { count: 9, min: 90, p50: 172, p95: 210, max: 230, avg: 168 },
    targetWpm: { count: 12, min: 110, p50: 166, p95: 190, max: 195, avg: 160 },
    paceCounts: { slow: 2, balanced: 5, brisk: 5 },
  },
  health: {
    realtimeBudgetMs: 5_000,
    sttBudgetMs: 2_500,
    slowLoopCount: 1,
    slowSttCount: 0,
    weakSignalCount: 0,
    echoTailResumeCount: 3,
    playbackBargeInCount: 2,
    suppressedEchoCount: 4,
  },
};

describe('CompanionVoiceMetrics', () => {
  it('renders aggregate response and turn-taking evidence without transcript text', () => {
    const { container } = render(<CompanionVoiceMetrics voice={VOICE_STATS} />);

    expect(screen.getByTestId('companion-voice-metrics')).toBeTruthy();
    expect(screen.getByText('p50 480 ms · p95 910 ms')).toBeTruthy();
    expect(screen.getByText('p50 620 ms · p95 1450 ms')).toBeTruthy();
    expect(screen.getByText('echo_tail · 420 ms')).toBeTruthy();
    expect(screen.getByText('3 / 2 / 4')).toBeTruthy();
    expect(screen.getByText('Humain 172 → Lisa 166 mots/min')).toBeTruthy();
    expect(screen.getByText('brisk · compact')).toBeTruthy();
    expect(container.textContent).toContain('sans verbatim agrégé');
    expect(container.textContent).not.toContain('phrase privée');
  });

  it('shows an honest empty state before turn-taking samples exist', () => {
    render(
      <CompanionVoiceMetrics
        voice={{
          ...VOICE_STATS,
          hearingCount: 0,
          latest: undefined,
          latency: {},
          delivery: undefined,
        }}
      />,
    );

    expect(screen.getAllByText('Pas encore mesuré')).toHaveLength(5);
  });
});
