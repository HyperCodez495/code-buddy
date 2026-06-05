/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HermesDoctorStrip, type HermesDoctorReview } from '../src/renderer/components/hermes-doctor-strip';

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

const ready: HermesDoctorReview = {
  agentName: 'Hermes',
  areas: [
    { id: 'providers', label: 'Providers', ok: true },
    { id: 'runtime', label: 'Runtime backends', ok: true },
    { id: 'browser', label: 'Browser backends', ok: false },
    { id: 'prompt', label: 'Prompt checks', ok: true },
  ],
  command: 'buddy hermes doctor --json',
  disabledToolCount: 1,
  dispatchProfile: 'balanced',
  enabledToolCount: 2,
  issues: [],
  ok: true,
  recommendations: ['All good.'],
  source: 'built-in',
};

describe('HermesDoctorStrip', () => {
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

  it('renders aggregate health, per-area readiness, and the CLI command', () => {
    const target = container();
    root = createRoot(target);
    act(() => {
      root?.render(React.createElement(HermesDoctorStrip, { readiness: ready }));
    });
    const strip = target.querySelector('[data-testid="fleet-hermes-doctor"]');
    expect(strip?.textContent).toContain('Hermes doctor');
    expect(strip?.textContent).toContain('healthy');
    expect(strip?.textContent).toContain('Providers');
    expect(strip?.textContent).toContain('Browser backends');
    expect(strip?.textContent).toContain('2 tools enabled / 1 disabled');
    expect(strip?.textContent).toContain('buddy hermes doctor --json');
    expect(target.querySelector('[data-testid="hermes-doctor-area-browser"]')).not.toBeNull();
  });

  it('loads from the readonly Electron bridge when no prop is provided', async () => {
    const target = container();
    const get = vi.fn().mockResolvedValue(ready);
    (window as unknown as {
      electronAPI?: { tools?: { hermesDoctor?: { get: typeof get } } };
    }).electronAPI = { tools: { hermesDoctor: { get } } };
    root = createRoot(target);
    await act(async () => {
      root?.render(React.createElement(HermesDoctorStrip));
      await Promise.resolve();
    });
    expect(get).toHaveBeenCalledWith();
    expect(target.textContent).toContain('Providers');
  });
});
