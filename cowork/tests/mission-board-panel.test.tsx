/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MissionBoardPanel } from '../src/renderer/components/MissionBoardPanel';
import { useAppStore } from '../src/renderer/store';
import type { CompanionMission } from '../src/renderer/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, maybeOptions?: Record<string, unknown>) => {
      const template = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : key;
      const options = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : maybeOptions;
      return Object.entries(options ?? {}).reduce(
        (value, [optionKey, optionValue]) => value.replaceAll(`{{${optionKey}}}`, String(optionValue)),
        template
      );
    },
  }),
}));

function mission(overrides: Partial<CompanionMission> = {}): CompanionMission {
  return {
    id: 'mission-1',
    title: 'Build autonomous mission tracking',
    dimension: 'autonomy',
    status: 'open',
    priority: 'P0',
    summary: 'Expose a mission board.',
    recommendation: 'Create a visible mission board for long-running work.',
    sourceGapId: 'gap-1',
    competitorRefs: ['Open Cowork'],
    command: '/mission build board',
    tags: ['roadmap'],
    createdAt: '2026-06-07T15:00:00.000Z',
    updatedAt: '2026-06-07T15:30:00.000Z',
    ...overrides,
  };
}

function board(items: CompanionMission[]) {
  return {
    schemaVersion: 1 as const,
    cwd: '/ws',
    storePath: '/ws/.codebuddy/companion-missions.json',
    updatedAt: '2026-06-07T15:30:00.000Z',
    missions: items,
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('MissionBoardPanel', () => {
  let root: Root | null = null;
  const container = () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    return element;
  };

  beforeEach(() => {
    useAppStore.setState({ workingDir: '/ws', activeSessionId: null, sessions: [] });
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    document.body.innerHTML = '';
  });

  it('lists companion missions and prepares the next mission as a dry run', async () => {
    const item = mission();
    const listMissions = vi.fn().mockResolvedValue({ ok: true, board: board([item]), items: [item] });
    const runNextMission = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        success: true,
        dryRun: true,
        message: 'Prepared next mission brief.',
        mission: item,
        board: board([item]),
      },
    });
    const syncMissions = vi.fn();
    const updateMission = vi.fn();

    (
      window as unknown as {
        electronAPI?: {
          companion: {
            listMissions: typeof listMissions;
            runNextMission: typeof runNextMission;
            syncMissions: typeof syncMissions;
            updateMission: typeof updateMission;
          };
        };
      }
    ).electronAPI = {
      companion: { listMissions, runNextMission, syncMissions, updateMission },
    };

    const target = container();
    root = createRoot(target);
    await act(async () => {
      root?.render(React.createElement(MissionBoardPanel, { onClose: () => {} }));
      await flush();
    });

    expect(listMissions).toHaveBeenCalledTimes(1);
    expect(target.querySelector('[data-testid="mission-card-mission-1"]')?.textContent).toContain(
      'Build autonomous mission tracking'
    );

    const prepare = target.querySelector('[data-testid="mission-board-prepare-next"]') as HTMLButtonElement;
    await act(async () => {
      Simulate.click(prepare);
      await flush();
    });

    expect(runNextMission).toHaveBeenCalledWith({ dryRun: true });
    expect(target.querySelector('[data-testid="mission-board-run-result"]')?.textContent).toContain(
      'Prepared next mission brief.'
    );
  });

  it('updates mission status through the companion bridge', async () => {
    const item = mission();
    const listMissions = vi.fn().mockResolvedValue({ ok: true, board: board([item]), items: [item] });
    const updateMission = vi.fn().mockResolvedValue({
      ok: true,
      mission: mission({ status: 'in_progress' }),
    });
    const syncMissions = vi.fn();
    const runNextMission = vi.fn();

    (
      window as unknown as {
        electronAPI?: {
          companion: {
            listMissions: typeof listMissions;
            runNextMission: typeof runNextMission;
            syncMissions: typeof syncMissions;
            updateMission: typeof updateMission;
          };
        };
      }
    ).electronAPI = {
      companion: { listMissions, runNextMission, syncMissions, updateMission },
    };

    const target = container();
    root = createRoot(target);
    await act(async () => {
      root?.render(React.createElement(MissionBoardPanel, { onClose: () => {} }));
      await flush();
    });

    const start = target.querySelector('[data-testid="mission-start-mission-1"]') as HTMLButtonElement;
    await act(async () => {
      Simulate.click(start);
      await flush();
    });

    expect(updateMission).toHaveBeenCalledWith({
      missionId: 'mission-1',
      status: 'in_progress',
    });
  });
});
