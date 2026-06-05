/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act, Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClawMigrationDialog } from '../src/renderer/components/ClawMigrationDialog';

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
        (value, [optionKey, optionValue]) => value.replaceAll(`{{${optionKey}}}`, String(optionValue)),
        template,
      );
    },
  }),
}));

function dryRunReport() {
  return {
    kind: 'hermes_claw_migration' as const,
    schemaVersion: 1 as const,
    detected: true,
    openClawHome: '/home/u/.openclaw',
    workspaceTarget: '/home/u/project',
    preset: 'user-data' as const,
    migrateSecrets: false,
    dryRun: true,
    applied: false,
    backupPath: null,
    entries: [
      {
        category: 'persona',
        label: 'Persona / SOUL',
        action: 'import' as const,
        source: '/home/u/.openclaw/soul.md',
        destination: 'SOUL.md',
        detail: 'Imports persona',
      },
    ],
    summary: { import: 1, archive: 0, skip: 0, conflict: 0, appliedCount: 0, failedCount: 0, total: 1 },
    notes: [],
  };
}

describe('ClawMigrationDialog', () => {
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

  it('loads a dry-run preview on open and requires an explicit confirm before running', async () => {
    const status = vi.fn().mockResolvedValue(dryRunReport());
    const run = vi.fn().mockResolvedValue({
      ok: true,
      report: { ...dryRunReport(), dryRun: false, applied: true, summary: { ...dryRunReport().summary, appliedCount: 1 } },
    });
    (window as unknown as {
      electronAPI?: { tools?: { hermesClaw?: { status: typeof status; run: typeof run } } };
    }).electronAPI = { tools: { hermesClaw: { status, run } } };

    const target = container();
    root = createRoot(target);
    await act(async () => {
      root?.render(React.createElement(ClawMigrationDialog, { onClose: () => {} }));
      await Promise.resolve();
    });

    // dry-run preview loaded, no apply yet
    expect(status).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(target.textContent).toContain('OpenClaw installation detected.');
    expect(target.querySelector('[data-testid="claw-entry-persona"]')).not.toBeNull();

    // first click only arms confirmation
    const runButton = target.querySelector('[data-testid="claw-run"]') as HTMLButtonElement;
    expect(runButton).not.toBeNull();
    await act(async () => {
      Simulate.click(runButton);
      await Promise.resolve();
    });
    expect(run).not.toHaveBeenCalled();

    // confirm performs the migration
    const confirmButton = target.querySelector('[data-testid="claw-confirm-run"]') as HTMLButtonElement;
    expect(confirmButton).not.toBeNull();
    await act(async () => {
      Simulate.click(confirmButton);
      await Promise.resolve();
    });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ preset: 'user-data', skillConflict: 'skip' }),
    );
  });
});
