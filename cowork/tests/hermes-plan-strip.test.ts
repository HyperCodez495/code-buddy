/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HermesPlanStrip } from '../src/renderer/components/hermes-plan-strip';

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

describe('HermesPlanStrip', () => {
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

  it('renders the selected Hermes plan and seeds a Fleet goal on click', () => {
    const target = container();
    const onUseAsGoal = vi.fn();
    const onScheduleGoal = vi.fn();
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(HermesPlanStrip, {
          profile: 'safe',
          onUseAsGoal,
          onScheduleGoal,
        }),
      );
    });

    const strip = target.querySelector('[data-testid="fleet-hermes-plan"]');
    expect(strip?.textContent).toContain('fleet.hermes.safe');
    expect(strip?.textContent).toContain('4 steps');
    expect(strip?.textContent).toContain('2 read-only');
    expect(strip?.textContent).toContain('1 local-write');
    expect(strip?.textContent).toContain('1 interactive');
    expect(strip?.textContent).toContain('buddy hermes plan safe --json');
    expect(strip?.textContent).toContain('Export a navigable lessons vault');

    const buttons = Array.from(target.querySelectorAll('button'));
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.textContent).toContain('Use as Fleet goal');
    expect(buttons[1]?.textContent).toContain('Schedule plan');

    act(() => {
      buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onUseAsGoal).toHaveBeenCalledTimes(1);
    const goal = onUseAsGoal.mock.calls[0]?.[0] as string;
    expect(goal).toContain('Run this Hermes integration plan from Cowork.');
    expect(goal).toContain('Dispatch profile: safe');
    expect(goal).toContain('Toolset: fleet.hermes.safe');
    expect(goal).toContain('Recommended CLI check: buddy hermes doctor safe --json');
    expect(goal).toContain('- Cowork: Render the checklist');
    expect(goal).toContain('Export a navigable lessons vault [prepare, local-write]');
    expect(goal).toContain('Acceptance: The generated vault includes a manifest.json file.');

    act(() => {
      buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onScheduleGoal).toHaveBeenCalledTimes(1);
    expect(onScheduleGoal.mock.calls[0]?.[0]).toBe(goal);
  });
});
