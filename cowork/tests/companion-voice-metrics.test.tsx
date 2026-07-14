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
        }}
      />,
    );

    expect(screen.getAllByText('Pas encore mesuré')).toHaveLength(3);
  });
});
