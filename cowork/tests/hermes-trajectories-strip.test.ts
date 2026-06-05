/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HermesTrajectoriesStrip,
  type HermesTrajectoriesReview,
} from '../src/renderer/components/hermes-trajectories-strip';

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

const ready: HermesTrajectoriesReview = {
  availableCount: 3,
  capabilities: [
    {
      commands: ['buddy run trajectory-export <run-id> --json'],
      id: 'trajectory-export',
      label: 'Redacted trajectory export',
      notes: [],
      officialSurface: 'Export a complete trajectory',
      status: 'available',
    },
  ],
  command: 'buddy hermes trajectories status --json',
  generatedAt: '2026-06-05T10:00:00.000Z',
  goldenFixtureCount: 5,
  missingCount: 0,
  ok: true,
  partialCount: 0,
  policyEvalCount: 4,
  recommendations: ['Trajectories ready.'],
  total: 3,
};

describe('HermesTrajectoriesStrip', () => {
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

  it('renders capability rollup and the CLI command', () => {
    const target = container();
    root = createRoot(target);
    act(() => {
      root?.render(React.createElement(HermesTrajectoriesStrip, { readiness: ready }));
    });
    const strip = target.querySelector('[data-testid="fleet-hermes-trajectories"]');
    expect(strip?.textContent).toContain('Hermes research trajectories');
    expect(strip?.textContent).toContain('trajectories ready');
    expect(strip?.textContent).toContain('3/3');
    expect(strip?.textContent).toContain('Redacted trajectory export');
    expect(strip?.textContent).toContain('buddy hermes trajectories status --json');
  });

  it('loads from the readonly Electron bridge when no prop is provided', async () => {
    const target = container();
    const get = vi.fn().mockResolvedValue(ready);
    (window as unknown as {
      electronAPI?: { tools?: { hermesTrajectories?: { get: typeof get } } };
    }).electronAPI = { tools: { hermesTrajectories: { get } } };
    root = createRoot(target);
    await act(async () => {
      root?.render(React.createElement(HermesTrajectoriesStrip));
      await Promise.resolve();
    });
    expect(get).toHaveBeenCalledWith();
    expect(target.textContent).toContain('Redacted trajectory export');
  });
});
