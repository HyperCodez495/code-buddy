/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SkillCandidateReviewQueueStrip,
  buildSkillCandidateReviewCommands,
  buildSkillCandidateReviewQueueGoal,
} from '../src/renderer/components/skill-candidate-review-queue-strip';

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

describe('SkillCandidateReviewQueueStrip', () => {
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

  it('renders the CLI review queue and seeds a safe Fleet goal', () => {
    const target = container();
    const onUseAsGoal = vi.fn();
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(SkillCandidateReviewQueueStrip, {
          candidates: [
            {
              eligible: true,
              kind: 'learning',
              reason: '2 successful runs met the promotion threshold.',
              skillName: 'learned-search-view-file-bash',
              skillPath: '.codebuddy/skill-candidates/learning/learned-search-view-file-bash/SKILL.md',
              sourceJobId: '',
              sourceRunId: 'run-learning-architect',
              successfulRunCount: 2,
              toolSequence: ['search', 'view_file', 'bash'],
            },
          ],
          error: 'candidate manifest is unreadable',
          onUseAsGoal,
        }),
      );
    });

    const strip = target.querySelector('[data-testid="fleet-skill-candidate-review-queue"]');
    expect(strip?.textContent).toContain('Skill candidate review');
    expect(strip?.textContent).toContain('1 eligible');
    expect(strip?.textContent).toContain('human approval required');
    expect(strip?.textContent).toContain('no auto-install');
    expect(strip?.textContent).toContain('Candidate queue load failed');
    expect(strip?.textContent).toContain('candidate manifest is unreadable');
    expect(strip?.textContent).toContain('learned-search-view-file-bash');
    expect(strip?.textContent).toContain('Learning Agent');
    expect(strip?.textContent).toContain('run-learning-architect');
    expect(strip?.textContent).toContain('Tools: search -> view_file -> bash');
    expect(strip?.textContent).toContain('buddy tools skill-candidate list --eligible-only --json');
    expect(strip?.textContent).toContain('buddy tools skill-candidate inspect <candidate-dir>');

    const button = target.querySelector('button');
    expect(button?.textContent).toContain('Review queue as goal');

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onUseAsGoal).toHaveBeenCalledTimes(1);
    const goal = onUseAsGoal.mock.calls[0]?.[0] as string;
    expect(goal).toContain('Review the shared SKILL.md candidate queue from Cowork.');
    expect(goal).toContain('Learning Agent retrospective candidates.');
    expect(goal).toContain('buddy tools skill-candidate list --eligible-only --json');
    expect(goal).toContain('Do not install a candidate automatically.');
    expect(goal).toContain('Install only after a human reviewer approves with --approved-by.');
  });

  it('keeps the command and goal helpers aligned', () => {
    const commands = buildSkillCandidateReviewCommands();
    const goal = buildSkillCandidateReviewQueueGoal();

    expect(commands).toEqual([
      'buddy tools skill-candidate list --eligible-only --json',
      'buddy tools skill-candidate inspect <candidate-dir>',
      'buddy tools skill-candidate install <candidate-dir> --approved-by <name>',
    ]);
    for (const command of commands.slice(0, 2)) {
      expect(goal).toContain(command);
    }
  });

  it('loads eligible candidates from the readonly Electron bridge when no candidates are provided', async () => {
    const target = container();
    const list = vi.fn().mockResolvedValue([
      {
        eligible: true,
        kind: 'research-script',
        reason: '2 successful runs met the promotion threshold.',
        skillName: 'research-loaded-candidate',
        skillPath: '.codebuddy/skill-candidates/research-loaded-candidate/SKILL.md',
        sourceJobId: 'research-script-loaded',
        successfulRunCount: 2,
      },
    ]);
    (window as unknown as {
      electronAPI?: {
        tools?: {
          skillCandidate?: {
            list: typeof list;
          };
        };
      };
    }).electronAPI = {
      tools: {
        skillCandidate: {
          list,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(SkillCandidateReviewQueueStrip, { cwd: 'D:/CascadeProjects/grok-cli-weekend' }));
      await Promise.resolve();
    });

    expect(list).toHaveBeenCalledWith({
      cwd: 'D:/CascadeProjects/grok-cli-weekend',
      eligibleOnly: true,
      limit: 3,
    });
    expect(target.textContent).toContain('research-loaded-candidate');
    expect(target.textContent).toContain('research-script-loaded');
  });
});
