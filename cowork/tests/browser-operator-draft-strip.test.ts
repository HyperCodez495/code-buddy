/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BrowserOperatorDraftStrip,
} from '../src/renderer/components/browser-operator-draft-strip';

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

describe('BrowserOperatorDraftStrip', () => {
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
    document.body.innerHTML = '';
  });

  it('renders an inspectable Browser Operator draft and seeds Fleet goals safely', () => {
    const target = container();
    const onUseAsGoal = vi.fn();
    const onScheduleGoal = vi.fn();
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(BrowserOperatorDraftStrip, {
          goal: 'Verifier le formulaire public du site',
          onUseAsGoal,
          onScheduleGoal,
        }),
      );
    });

    const strip = target.querySelector('[data-testid="fleet-browser-operator-draft"]');
    expect(strip?.textContent).toContain('Browser Operator draft');
    expect(strip?.textContent).toContain('isolated');
    expect(strip?.textContent).toContain('3 actions');
    expect(strip?.textContent).toContain('isolated preview');
    expect(strip?.textContent).toContain('Read the source before opening a browser');
    expect(strip?.textContent).toContain('browser.extract');
    expect(strip?.textContent).toContain('.browser-operator.json');

    const buttons = Array.from(target.querySelectorAll('button'));
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.textContent).toContain('Use draft as goal');
    expect(buttons[1]?.textContent).toContain('Schedule review');

    act(() => {
      buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onUseAsGoal).toHaveBeenCalledTimes(1);
    const goal = onUseAsGoal.mock.calls[0]?.[0] as string;
    expect(goal).toContain('Review this Browser Operator draft from Cowork');
    expect(goal).toContain('# Browser Operator Session: Verifier le formulaire public du site');
    expect(goal).toContain('Consent: not required');
    expect(goal).toContain('## Source Plan');
    expect(goal).toContain('do not bypass login walls');

    act(() => {
      buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onScheduleGoal).toHaveBeenCalledTimes(1);
    expect(onScheduleGoal.mock.calls[0]?.[0]).toBe(goal);
    expect(onScheduleGoal.mock.calls[0]?.[1]).toMatchObject({
      browserOperatorActionCount: 3,
      browserOperatorConsentRequired: false,
      browserOperatorMode: 'isolated',
      browserOperatorSurface: 'cowork',
    });
  });

  it('shows local consent posture when requested', () => {
    const target = container();
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(BrowserOperatorDraftStrip, {
          goal: 'Verifier un espace client',
          mode: 'local',
        }),
      );
    });

    const strip = target.querySelector('[data-testid="fleet-browser-operator-draft"]');
    expect(strip?.textContent).toContain('local');
    expect(strip?.textContent).toContain('consent required');
  });
});
