/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScheduledWorkStrip } from '../src/renderer/components/fleet-scheduled-work-strip';
import type { ScheduleTask } from '../src/renderer/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, maybeOptions?: Record<string, unknown>) => {
      const template = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : key;
      const options = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : maybeOptions;
      return Object.entries(options ?? {}).reduce(
        (value, [optionKey, optionValue]) =>
          value.replaceAll(`{{${optionKey}}}`, String(optionValue)),
        template,
      );
    },
  }),
}));

vi.mock('../src/renderer/utils/i18n-format', () => ({
  formatAppDateTime: () => 'May 18, 22:00',
  joinAppList: (values: string[]) => values.join(', '),
}));

const baseTask: ScheduleTask = {
  id: 'task-hermes',
  title: 'Hermes nightly plan',
  prompt: 'Run the Hermes plan',
  cwd: 'D:/CascadeProjects/grok-cli-weekend',
  runAt: Date.UTC(2026, 4, 18, 22, 0),
  nextRunAt: Date.UTC(2026, 4, 18, 22, 0),
  scheduleConfig: null,
  repeatEvery: null,
  repeatUnit: null,
  enabled: true,
  lastRunAt: null,
  lastRunSessionId: null,
  lastError: null,
  metadata: {
    source: 'fleet-command-center',
    hermesPlanId: 'hermes-integration-plan',
    hermesPlanProfile: 'safe',
    dispatchProfile: 'safe',
    privacyTag: 'public',
  },
  createdAt: Date.UTC(2026, 4, 18, 12, 0),
  updatedAt: Date.UTC(2026, 4, 18, 12, 0),
};

describe('ScheduledWorkStrip', () => {
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    document.body.innerHTML = '';
  });

  it('renders Hermes lineage in the icon-only run-now button label', () => {
    const target = document.createElement('div');
    const onRunNow = vi.fn();
    document.body.appendChild(target);
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(ScheduledWorkStrip, {
          tasks: [baseTask],
          upcomingTasks: [baseTask],
          error: null,
          runningTaskId: null,
          onRunNow,
        }),
      );
    });

    const strip = target.querySelector('[data-testid="fleet-scheduled-work"]');
    expect(strip?.textContent).toContain('Hermes nightly plan');
    expect(strip?.textContent).toContain('Hermes safe');
    expect(strip?.textContent).toContain('Profile safe');

    const runNowButton = target.querySelector(
      'button[aria-label="Run Hermes safe now"]',
    ) as HTMLButtonElement | null;
    expect(runNowButton).not.toBeNull();
    expect(runNowButton?.title).toBe('Run Hermes safe now');

    act(() => {
      runNowButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onRunNow).toHaveBeenCalledWith('task-hermes');
  });

  it('keeps Hermes lineage in the running spinner label', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(ScheduledWorkStrip, {
          tasks: [baseTask],
          upcomingTasks: [baseTask],
          error: null,
          runningTaskId: 'task-hermes',
          onRunNow: vi.fn(),
        }),
      );
    });

    const runningButton = target.querySelector(
      'button[aria-label="Running Hermes safe"]',
    ) as HTMLButtonElement | null;
    expect(runningButton).not.toBeNull();
    expect(runningButton?.title).toBe('Running Hermes safe');
    expect(runningButton?.disabled).toBe(true);
  });
});
