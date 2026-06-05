/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act, Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SkillsManagerPage } from '../src/renderer/components/skills-manager-page';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallbackOrOptions?: string | Record<string, unknown>,
      maybeOptions?: Record<string, unknown>,
    ) => {
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

// The page reads cwd from the zustand store; stub it to a stable workspace so
// the IPC bridges receive a deterministic cwd.
vi.mock('../src/renderer/store', () => {
  const state = {
    activeSessionId: null,
    sessions: [],
    workingDir: 'D:/CascadeProjects/grok-cli-weekend',
    showSkillsManager: true,
    setShowSkillsManager: vi.fn(),
  };
  const useAppStore = (selector: (s: typeof state) => unknown) => selector(state);
  return { useAppStore };
});

function makeSummary() {
  return {
    cacheDir: 'D:/workspace/.codebuddy/skills-cache',
    disabledCount: 0,
    enabledCount: 1,
    installedCount: 1,
    lockfilePath: 'D:/workspace/.codebuddy/skills-lock.json',
    packages: [
      {
        contentPreview: '# Audit Helper\n\nRun real checks and capture evidence.',
        enabled: true,
        exists: true,
        installedAt: 1,
        integrityOk: true,
        name: 'audit-helper',
        path: 'D:/workspace/.codebuddy/skills/audit-helper/SKILL.md',
        rollbackableCount: 0,
        source: 'local' as const,
        status: 'active' as const,
        version: '1.0.0',
      },
    ],
    reviewCommands: ['buddy skills list --all --json'],
    rollbackableCount: 0,
    skillRoot: 'D:/workspace/.codebuddy/skills',
  };
}

describe('SkillsManagerPage', () => {
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
    vi.clearAllMocks();
  });

  it('aggregates installed skills (with SKILL.md preview) and the candidate queue via IPC', async () => {
    const target = container();
    const skillPackageList = vi.fn().mockResolvedValue(makeSummary());
    const candidateList = vi.fn().mockResolvedValue([
      {
        candidateDiffPreview: {
          addedLines: 2,
          preview: '+ added candidate line',
          removedLines: 0,
          summary: 'SKILL.md candidate diff',
          truncated: false,
        },
        eligible: true,
        installState: 'not-installed' as const,
        kind: 'learning',
        reason: 'repeated successful runs',
        skillName: 'research-summary',
        skillPath: 'D:/workspace/.codebuddy/skill-candidates/research-summary',
        sourceJobId: 'job-1',
        successfulRunCount: 3,
      },
    ]);

    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      tools: {
        skillPackage: { list: skillPackageList },
        skillCandidate: { list: candidateList },
      },
    };

    root = createRoot(target);
    await act(async () => {
      root?.render(React.createElement(SkillsManagerPage, { onClose: vi.fn() }));
      await Promise.resolve();
      await Promise.resolve();
    });

    // The page loads the full installed summary with a high limit (not the
    // cockpit's 3-item cap).
    expect(skillPackageList).toHaveBeenCalledWith({
      cwd: 'D:/CascadeProjects/grok-cli-weekend',
      limit: 100,
    });
    // The candidate strip self-loads through the candidate bridge.
    expect(candidateList).toHaveBeenCalled();

    const page = target.querySelector('[data-testid="skills-manager-page"]');
    expect(page?.textContent).toContain('Skills Manager');
    expect(page?.textContent).toContain('1 installed');
    // Installed skill + its SKILL.md preview.
    expect(page?.textContent).toContain('audit-helper');
    expect(page?.textContent).toContain('Run real checks and capture evidence.');
    // Candidate queue.
    expect(page?.textContent).toContain('research-summary');
    expect(page?.textContent).toContain('SKILL.md candidate diff');
  });

  it('triggers a review-gated disable through the skillPackage.lifecycle IPC', async () => {
    const target = container();
    const skillPackageList = vi.fn().mockResolvedValue(makeSummary());
    const lifecycle = vi.fn().mockResolvedValue({
      ok: true,
      package: {
        enabled: false,
        exists: true,
        installedAt: 1,
        integrityOk: true,
        lastLifecycleReviewer: 'Patrice',
        name: 'audit-helper',
        path: 'D:/workspace/.codebuddy/skills/audit-helper/SKILL.md',
        rollbackableCount: 0,
        source: 'local',
        status: 'disabled',
        version: '1.0.0',
      },
    });
    const candidateList = vi.fn().mockResolvedValue([]);

    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      tools: {
        skillPackage: { list: skillPackageList, lifecycle },
        skillCandidate: { list: candidateList },
      },
    };

    root = createRoot(target);
    await act(async () => {
      root?.render(React.createElement(SkillsManagerPage, { onClose: vi.fn() }));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Disable is gated on a reviewer name.
    let disableButton = target.querySelector(
      '[data-testid="skill-package-disable"]',
    ) as HTMLButtonElement;
    expect(disableButton.disabled).toBe(true);

    const reviewerInput = target.querySelector(
      '[data-testid="skill-package-reviewer-input"]',
    ) as HTMLInputElement;
    await act(async () => {
      Simulate.change(reviewerInput, { target: { value: 'Patrice' } } as unknown as Event);
      await Promise.resolve();
    });

    disableButton = target.querySelector(
      '[data-testid="skill-package-disable"]',
    ) as HTMLButtonElement;
    expect(disableButton.disabled).toBe(false);

    await act(async () => {
      Simulate.click(disableButton);
      await Promise.resolve();
    });

    expect(lifecycle).toHaveBeenCalledWith({
      action: 'disable',
      approvedBy: 'Patrice',
      cwd: 'D:/CascadeProjects/grok-cli-weekend',
      name: 'audit-helper',
    });
    expect(target.textContent).toContain('disable audit-helper by Patrice.');
  });

  it('invokes onClose from the close button', async () => {
    const target = container();
    const onClose = vi.fn();
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      tools: {
        skillPackage: { list: vi.fn().mockResolvedValue(makeSummary()) },
        skillCandidate: { list: vi.fn().mockResolvedValue([]) },
      },
    };

    root = createRoot(target);
    await act(async () => {
      root?.render(React.createElement(SkillsManagerPage, { onClose }));
      await Promise.resolve();
    });

    const closeButton = target.querySelector(
      '[data-testid="skills-manager-close"]',
    ) as HTMLButtonElement;
    await act(async () => {
      Simulate.click(closeButton);
      await Promise.resolve();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
