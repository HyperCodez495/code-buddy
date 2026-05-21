import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import {
  buildScheduleConfigFromForm,
  buildScheduleMetadataChipsFromMetadata,
  buildScheduleSignatureFromForm,
  computeNextScheduledRun,
  detectScheduleMode,
  formatScheduleRule,
  isValidTimeValue,
  toggleTimeValue,
  toggleWeekdayValue,
} from '../src/renderer/components/settings/schedule-helpers';
import type { ScheduleTask } from '../src/renderer/types';

const templates: Record<string, string> = {
  'schedule.sourceFleet': 'Fleet',
  'schedule.profileChip': 'Profile {{value}}',
  'schedule.privacyChip': 'Privacy {{value}}',
  'schedule.parallelismChip': 'Parallel {{value}}',
  'schedule.peerCountChip': '{{count}} peers',
  'schedule.targetPeersChip': 'Targets {{value}}',
  'schedule.deliveryChannelChip': 'Channel {{value}}',
  'schedule.memoryChip': 'Memory {{count}}',
  'schedule.webProofChip': 'Web proof {{steps}}{{required}}',
  'schedule.webProofAssertChip': 'Web proof {{steps}}{{required}} assert {{assertions}}',
  'schedule.ruleDaily': 'Daily {{times}}',
  'schedule.ruleWeekly': 'Weekly {{weekdays}} at {{times}}',
  'schedule.ruleOnce': 'One-time',
  'schedule.repeatEveryMinute': 'Every {{count}} minutes',
  'schedule.repeatEveryHour': 'Every {{count}} hours',
  'schedule.repeatEveryDay': 'Every {{count}} days',
  'schedule.unknownWeekday': 'Unknown',
  'schedule.hermesPlanChip': 'Hermes {{value}}',
};

const t = ((key: string, options?: Record<string, unknown>) =>
  Object.entries(options ?? {}).reduce(
    (value, [optionKey, optionValue]) =>
      value.replaceAll(`{{${optionKey}}}`, String(optionValue)),
    templates[key] ?? key,
  )) as TFunction;

const baseTask: ScheduleTask = {
  id: 'task-1',
  title: 'Nightly review',
  prompt: 'Review Fleet work',
  cwd: 'D:/CascadeProjects/grok-cli-weekend',
  runAt: new Date(2026, 4, 16, 8, 0).getTime(),
  nextRunAt: new Date(2026, 4, 16, 8, 0).getTime(),
  scheduleConfig: null,
  repeatEvery: null,
  repeatUnit: null,
  enabled: true,
  lastRunAt: null,
  lastRunSessionId: null,
  lastError: null,
  metadata: null,
  createdAt: new Date(2026, 4, 16, 7, 0).getTime(),
  updatedAt: new Date(2026, 4, 16, 7, 0).getTime(),
};

describe('schedule helpers', () => {
  it('builds Fleet metadata chips without leaking prompt content', () => {
    expect(
      buildScheduleMetadataChipsFromMetadata(
        {
          source: 'fleet-command-center',
          dispatchProfile: 'review',
          privacyTag: 'sensitive',
          parallelism: 3,
          peerCount: 2,
          targetPeerLabels: ['alpha', 'beta'],
          deliveryChannel: 'cowork-schedule',
          memoryCount: 2,
          hermesPlanId: 'hermes-integration-plan',
          hermesPlanProfile: 'safe',
          internetProofStepCount: 5,
          internetProofRequiredCount: 4,
          internetProofAssertionCount: 1,
          prompt: 'do not render me',
        },
        t,
      ),
    ).toEqual([
      'Fleet',
      'Hermes safe',
      'Profile review',
      'Privacy sensitive',
      'Parallel 3',
      '2 peers',
      'Targets alpha, beta',
      'Channel cowork-schedule',
      'Memory 2',
      'Web proof 5/4 assert 1',
    ]);
  });

  it('normalizes schedule form values and signatures', () => {
    expect(
      buildScheduleConfigFromForm('daily', ['18:00', '08:00', '08:00', '99:00'], [1]),
    ).toEqual({
      kind: 'daily',
      times: ['08:00', '18:00'],
    });
    expect(buildScheduleConfigFromForm('weekly', ['18:00', '08:00'], [5, 1, 1])).toEqual({
      kind: 'weekly',
      weekdays: [1, 5],
      times: ['08:00', '18:00'],
    });
    expect(
      buildScheduleSignatureFromForm('legacy-interval', '2026-05-16T08:00', [], [], 2, 'hour'),
    ).toBe(
      JSON.stringify({
        mode: 'legacy-interval',
        runAt: '2026-05-16T08:00',
        repeatEvery: 2,
        repeatUnit: 'hour',
      }),
    );
  });

  it('computes the next daily and weekly run without returning past times', () => {
    const now = new Date(2026, 4, 16, 9, 0).getTime();
    expect(
      computeNextScheduledRun({ kind: 'daily', times: ['invalid', '08:00', '10:30'] }, now),
    ).toBe(new Date(2026, 4, 16, 10, 30).getTime());
    expect(
      computeNextScheduledRun({ kind: 'weekly', weekdays: [1], times: ['08:00'] }, now),
    ).toBe(new Date(2026, 4, 18, 8, 0).getTime());
  });

  it('formats rules, detects modes, and validates picker toggles', () => {
    const weekdayOptions = [
      { value: 1 as const, label: 'Monday' },
      { value: 5 as const, label: 'Friday' },
    ];

    expect(
      formatScheduleRule(
        {
          ...baseTask,
          scheduleConfig: { kind: 'weekly', weekdays: [1, 5], times: ['08:00'] },
        },
        t,
        weekdayOptions,
      ),
    ).toBe('Weekly Monday, Friday at 08:00');
    expect(detectScheduleMode({ ...baseTask, repeatEvery: 2, repeatUnit: 'hour' })).toBe(
      'legacy-interval',
    );
    expect(isValidTimeValue('23:59')).toBe(true);
    expect(isValidTimeValue('24:00')).toBe(false);
    expect(toggleTimeValue(['08:00'], '07:30')).toEqual(['07:30', '08:00']);
    expect(toggleTimeValue(['08:00'], '99:00')).toEqual(['08:00']);
    expect(toggleWeekdayValue([5], 1)).toEqual([1, 5]);
  });
});
