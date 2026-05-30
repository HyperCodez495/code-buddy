/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LessonCandidatePanel } from '../src/renderer/components/LessonCandidatePanel';
import { useAppStore } from '../src/renderer/store';
import type { LessonCandidate } from '../src/renderer/types/hermes';

const pendingCandidate: LessonCandidate = {
  id: 'lc-pending',
  category: 'RULE',
  content: 'Run real tests before claiming completion.',
  createdAt: Date.UTC(2026, 4, 30, 14, 30),
  source: 'manual',
  status: 'pending',
};

const approvedCandidate: LessonCandidate = {
  id: 'lc-approved',
  approvedLessonId: 'lesson-1',
  category: 'RULE',
  content: 'Keep successful review gates visible.',
  createdAt: Date.UTC(2026, 4, 30, 14, 35),
  reviewedAt: Date.UTC(2026, 4, 30, 14, 40),
  reviewedBy: 'Patrice',
  source: 'manual',
  status: 'approved',
};

describe('LessonCandidatePanel', () => {
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
    useAppStore.setState({ showLessonCandidatePanel: false });
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    document.body.innerHTML = '';
  });

  it('keeps the pending tab count global when the visible list is filtered', async () => {
    const target = container();
    const list = vi.fn(async (status?: string) => ({
      items: status === 'approved' ? [approvedCandidate] : [pendingCandidate],
      ok: true,
    }));
    const stats = vi.fn(async () => ({
      ok: true,
      stats: {
        byStatus: {
          approved: 1,
          discarded: 0,
          pending: 1,
        },
        total: 2,
      },
    }));

    (window as unknown as {
      electronAPI?: {
        lessonCandidate?: {
          approve: () => Promise<unknown>;
          discard: () => Promise<unknown>;
          list: typeof list;
          stats: typeof stats;
        };
      };
    }).electronAPI = {
      lessonCandidate: {
        approve: vi.fn(),
        discard: vi.fn(),
        list,
        stats,
      },
    };
    useAppStore.setState({ showLessonCandidatePanel: true });
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(LessonCandidatePanel));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(target.querySelector('[data-testid="lesson-tab-pending"]')?.textContent).toContain(
      'Pending (1)',
    );

    await act(async () => {
      target.querySelector<HTMLButtonElement>('[data-testid="lesson-tab-approved"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(list).toHaveBeenLastCalledWith('approved');
    expect(stats).toHaveBeenCalledTimes(2);
    expect(target.querySelector('[data-testid="lesson-tab-pending"]')?.textContent).toContain(
      'Pending (1)',
    );
    expect(target.querySelector('[data-testid="lesson-candidate"]')?.textContent).toContain(
      'Keep successful review gates visible.',
    );
  });
});
