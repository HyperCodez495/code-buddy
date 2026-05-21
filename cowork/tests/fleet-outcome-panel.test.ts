/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FleetOutcomeDetail,
  FleetOutcomeStrip,
} from '../src/renderer/components/fleet-outcome-panel';
import type { ActivityEntry } from '../src/renderer/components/fleet-command-center-helpers';
import { isAgentRun } from '../../src/agent/agent-run-contract.js';

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
  formatAppDateTime: () => 'May 18, 2026, 22:00',
  formatAppTime: () => '22:00',
  joinAppList: (values: string[]) => values.join(', '),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hermesOutcome: ActivityEntry = {
  id: 42,
  type: 'fleet.saga.completed',
  title: 'Fleet saga completed',
  description: 'Hermes research completed',
  timestamp: Date.UTC(2026, 4, 18, 22, 0),
  metadata: {
    sagaId: 'saga-hermes123456',
    status: 'completed',
    hermesPlanId: 'hermes-integration-plan',
    hermesPlanProfile: 'safe',
    hermesPlanSurface: 'cowork',
    dispatchProfile: 'research',
    privacyTag: 'public',
    completedSteps: 3,
    totalSteps: 3,
    durationMs: 2_400,
    targetPeerLabels: ['local-alpha', 'local-beta'],
    deliveryChannel: 'cowork-schedule',
    memoryCount: 2,
    toolDecisionCount: 3,
    toolAllowCount: 2,
    toolConfirmCount: 1,
    toolDenyCount: 0,
    internetProofStepCount: 4,
    internetProofRequiredCount: 3,
    internetProofAssertionCount: 1,
    finalResultPreview: 'Found and summarized public architect contacts.',
  },
};

describe('Fleet outcome panel', () => {
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    document.body.innerHTML = '';
    Reflect.deleteProperty(window, 'electronAPI');
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('renders Hermes outcome chips and selects an outcome from the strip', () => {
    const target = document.createElement('div');
    const onSelectOutcome = vi.fn();
    document.body.appendChild(target);
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(FleetOutcomeStrip, {
          entries: [hermesOutcome],
          error: null,
          selectedEntryId: null,
          onSelectOutcome,
        }),
      );
    });

    const strip = target.querySelector('[data-testid="fleet-recent-outcomes"]');
    expect(strip?.textContent).toContain('Hermes research completed');
    expect(strip?.textContent).toContain('Hermes safe');
    expect(strip?.textContent).toContain('Targets local-alpha, local-beta');
    expect(strip?.textContent).toContain('Channel cowork-schedule');
    expect(strip?.textContent).toContain('Memory 2');
    expect(strip?.textContent).toContain('web proof 4/3 assert 1');

    const selectButton = target.querySelector('button');
    expect(selectButton?.getAttribute('aria-label')).toContain('Open Fleet outcome:');
    expect(selectButton?.getAttribute('aria-label')).toContain('Hermes research completed');
    expect(selectButton?.getAttribute('aria-label')).toContain('Hermes safe');
    expect(selectButton?.getAttribute('aria-label')).toContain('web proof 4/3 assert 1');
    expect(selectButton?.getAttribute('title')).toContain('Channel cowork-schedule');
    act(() => {
      selectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSelectOutcome).toHaveBeenCalledWith(42);
  });

  it('turns a Hermes outcome into a follow-up goal and curated memory', async () => {
    const target = document.createElement('div');
    const onUseAsGoal = vi.fn();
    const onMemorySaved = vi.fn();
    const addMemory = vi.fn().mockResolvedValue({ success: true });
    const addLesson = vi.fn().mockResolvedValue({ success: true, lessonId: 'lesson-1' });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    Object.assign(window, {
      electronAPI: {
        memory: {
          add: addMemory,
        },
        lessons: {
          add: addLesson,
        },
      },
    });
    document.body.appendChild(target);
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(FleetOutcomeDetail, {
          entry: hermesOutcome,
          onUseAsGoal,
          onMemorySaved,
        }),
      );
    });

    expect(target.textContent).toContain('Hermes research completed');
    expect(target.textContent).toContain('Found and summarized public architect contacts.');
    const detailChips = target.querySelector('[data-testid="fleet-outcome-detail-chips"]');
    expect(detailChips?.textContent).toContain('Hermes safe');
    expect(detailChips?.textContent).toContain('Targets local-alpha, local-beta');
    expect(detailChips?.textContent).toContain('Channel cowork-schedule');
    expect(detailChips?.textContent).toContain('Memory 2');
    expect(detailChips?.textContent).toContain('web proof 4/3 assert 1');

    const copyOutcomeButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Copy outcome'),
    );
    expect(copyOutcomeButton?.getAttribute('aria-label')).toContain('Copy outcome -');
    expect(copyOutcomeButton?.getAttribute('aria-label')).toContain('Hermes safe');
    expect(copyOutcomeButton?.getAttribute('title')).toContain('web proof 4/3 assert 1');
    await act(async () => {
      copyOutcomeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(writeText).toHaveBeenCalledWith('Found and summarized public architect contacts.');
    expect(target.textContent).toContain('Copied');
    const copiedButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Copied'),
    );
    expect(copiedButton?.getAttribute('aria-label')).toContain('Copied -');
    expect(copiedButton?.getAttribute('aria-label')).toContain('Channel cowork-schedule');

    const useAsGoalButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Use as next goal'),
    );
    expect(useAsGoalButton?.getAttribute('aria-label')).toContain('Use as next goal -');
    expect(useAsGoalButton?.getAttribute('aria-label')).toContain('Hermes safe');
    expect(useAsGoalButton?.getAttribute('aria-label')).toContain('Targets local-alpha, local-beta');
    expect(useAsGoalButton?.getAttribute('title')).toContain('Channel cowork-schedule');
    act(() => {
      useAsGoalButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const followUpGoal = onUseAsGoal.mock.calls[0]?.[1] as string;
    const followUpRun = onUseAsGoal.mock.calls[0]?.[2];
    expect(followUpGoal).toContain('Hermes plan: id=hermes-integration-plan, profile=safe, surface=cowork');
    expect(followUpGoal).toContain('Targets: local-alpha, local-beta');
    expect(followUpGoal).toContain('Delivery channel: cowork-schedule');
    expect(followUpGoal).toContain('Memory context: 2');
    expect(followUpGoal).toContain('Web proof: 4/3 steps, 1 assertion');
    expect(isAgentRun(followUpRun)).toBe(true);
    expect(followUpRun).toMatchObject({
      source: 'cowork',
      status: 'draft',
      profile: 'research',
      privacyTag: 'public',
      lineage: {
        outcomeId: '42',
        sagaId: 'saga-hermes123456',
        deliveryChannel: 'cowork-schedule',
        hermesPlanId: 'hermes-integration-plan',
        hermesPlanProfile: 'safe',
        hermesPlanSurface: 'cowork',
      },
      fleet: {
        targetPeerLabels: ['local-alpha', 'local-beta'],
      },
      memory: {
        included: true,
        count: 2,
      },
      proof: {
        stepCount: 4,
        requiredCount: 3,
        assertionCount: 1,
      },
    });

    const saveMemoryButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Save as memory'),
    );
    expect(saveMemoryButton?.getAttribute('aria-label')).toContain('Save as memory -');
    expect(saveMemoryButton?.getAttribute('aria-label')).toContain('Memory 2');
    expect(saveMemoryButton?.getAttribute('title')).toContain('web proof 4/3 assert 1');
    await act(async () => {
      saveMemoryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(addMemory).toHaveBeenCalledTimes(1);
    expect(addMemory.mock.calls[0]?.[0]).toBe('pattern');
    const memoryContent = addMemory.mock.calls[0]?.[1] as string;
    expect(memoryContent).toContain('hermes=id=hermes-integration-plan, profile=safe, surface=cowork');
    expect(memoryContent).toContain('targets=local-alpha, local-beta');
    expect(memoryContent).toContain('channel=cowork-schedule');
    expect(memoryContent).toContain('memory=2');
    expect(onMemorySaved).toHaveBeenCalledTimes(1);
    expect(target.textContent).toContain('Saved as memory');

    const saveLessonButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Save as lesson'),
    );
    expect(saveLessonButton?.getAttribute('aria-label')).toContain('Save as lesson -');
    expect(saveLessonButton?.getAttribute('aria-label')).toContain('Hermes safe');
    expect(saveLessonButton?.getAttribute('title')).toContain('web proof 4/3 assert 1');
    await act(async () => {
      saveLessonButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(addLesson).toHaveBeenCalledTimes(1);
    expect(addLesson.mock.calls[0]?.[0]).toBe('PATTERN');
    const lessonContent = addLesson.mock.calls[0]?.[1] as string;
    expect(lessonContent).toContain('[[fleet-outcome]] [[agent-run-lineage]]');
    expect(lessonContent).toContain('Outcome id: 42');
    expect(lessonContent).toContain('Hermes context: id=hermes-integration-plan, profile=safe, surface=cowork');
    expect(lessonContent).toContain('Target peers: local-alpha, local-beta');
    expect(lessonContent).toContain('Web proof: 4/3 steps, 1 assertion');
    expect(target.textContent).toContain('Saved as lesson');
  });
});
