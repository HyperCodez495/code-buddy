/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LearningSkillUsageStrip,
  buildLearningSkillUsageCommand,
} from '../src/renderer/components/learning-skill-usage-strip';

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

describe('LearningSkillUsageStrip', () => {
  let root: Root | null = null;
  const container = () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    return element;
  };

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    document.body.innerHTML = '';
  });

  it('renders reinforced and deprecated Learning Agent usage telemetry', () => {
    const target = container();
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(LearningSkillUsageStrip, {
          usage: [
            {
              averageDurationMs: 1249.6,
              deprecated: false,
              failureCount: 0,
              invocationCount: 4,
              lastRunId: 'run-reinforced',
              lastUsedAt: '2026-05-30T14:00:00.000Z',
              nextAction: 'Prefer this skill for matching future tasks.',
              recommendation: 'reinforce',
              reinforced: true,
              score: 95,
              scoreReason: '100% success over 4 run(s); last evidence run run-reinforced.',
              skillName: 'learned-search-view-file-bash',
              successCount: 4,
            },
            {
              deprecated: true,
              failureCount: 2,
              invocationCount: 2,
              lastError: 'verification failed',
              lastRunId: 'run-deprecated',
              lastUsedAt: '2026-05-30T14:05:00.000Z',
              nextAction: 'Open a reviewed improvement candidate.',
              recommendation: 'deprecate',
              reinforced: false,
              score: 20,
              scoreReason: '0% success over 2 run(s), repeated failures detected.',
              skillName: 'learned-flaky-path',
              successCount: 0,
            },
          ],
          error: 'usage file unreadable',
        }),
      );
    });

    const strip = target.querySelector('[data-testid="fleet-learning-skill-usage"]');
    expect(strip?.textContent).toContain('Learning skill usage');
    expect(strip?.textContent).toContain('2 skills');
    expect(strip?.textContent).toContain('1 reinforced');
    expect(strip?.textContent).toContain('1 deprecated');
    expect(strip?.textContent).toContain('Learning usage load failed');
    expect(strip?.textContent).toContain('usage file unreadable');
    expect(strip?.textContent).toContain('learned-search-view-file-bash');
    expect(strip?.textContent).toContain('4 runs');
    expect(strip?.textContent).toContain('95/100 reinforce');
    expect(strip?.textContent).toContain('4 ok / 0 fail');
    expect(strip?.textContent).toContain('avg 1250ms');
    expect(strip?.textContent).toContain('evidence: run-reinforced');
    expect(strip?.textContent).toContain('reason: 100% success over 4 run(s)');
    expect(strip?.textContent).toContain('next: Prefer this skill');
    expect(strip?.textContent).toContain('run-reinforced');
    expect(strip?.textContent).toContain('learned-flaky-path');
    expect(strip?.textContent).toContain('20/100 deprecate');
    expect(strip?.textContent).toContain('verification failed');
    expect(strip?.textContent).toContain('buddy skills learning-usage --json');
  });

  it('keeps the CLI helper command stable', () => {
    expect(buildLearningSkillUsageCommand()).toBe('buddy skills learning-usage --json');
  });

  it('loads usage from the readonly Electron bridge when no usage is provided', async () => {
    const target = container();
    const list = vi.fn().mockResolvedValue([
      {
        deprecated: false,
        failureCount: 0,
        invocationCount: 1,
        lastRunId: 'run-loaded',
        lastUsedAt: '2026-05-30T14:10:00.000Z',
        nextAction: 'Keep observing.',
        recommendation: 'observe',
        reinforced: false,
        score: 35,
        scoreReason: '100% success over 1 run(s); evidence is still below the promotion threshold.',
        skillName: 'learned-loaded-skill',
        successCount: 1,
      },
    ]);
    (window as unknown as {
      electronAPI?: {
        tools?: {
          learningUsage?: {
            list: typeof list;
          };
        };
      };
    }).electronAPI = {
      tools: {
        learningUsage: {
          list,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(LearningSkillUsageStrip, { cwd: 'D:/CascadeProjects/grok-cli-weekend' }));
      await Promise.resolve();
    });

    expect(list).toHaveBeenCalledWith({
      cwd: 'D:/CascadeProjects/grok-cli-weekend',
      limit: 6,
    });
    expect(target.textContent).toContain('learned-loaded-skill');
    expect(target.textContent).toContain('run-loaded');
  });
});
