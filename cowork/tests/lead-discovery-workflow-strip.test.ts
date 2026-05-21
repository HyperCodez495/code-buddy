/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LeadDiscoveryWorkflowStrip,
} from '../src/renderer/components/lead-discovery-workflow-strip';

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

describe('LeadDiscoveryWorkflowStrip', () => {
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

  it('renders a public-data workflow preview and seeds Fleet goals safely', () => {
    const target = container();
    const onUseAsGoal = vi.fn();
    const onScheduleGoal = vi.fn();
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(LeadDiscoveryWorkflowStrip, {
          goal: 'Trouver des architectes proches de Nantes avec telephone public',
          targetLabel: 'architectes',
          zone: 'Nantes',
          offer: 'site web pour entrepreneur du batiment',
          onUseAsGoal,
          onScheduleGoal,
        }),
      );
    });

    const strip = target.querySelector('[data-testid="fleet-lead-discovery-workflow"]');
    expect(strip?.textContent).toContain('Public-data workflow');
    expect(strip?.textContent).toContain('7 stages');
    expect(strip?.textContent).toContain('7 artifacts');
    expect(strip?.textContent).toContain('review queue only');
    expect(strip?.textContent).toContain('Search public candidates');
    expect(strip?.textContent).toContain('contact-field-extraction');
    expect(strip?.textContent).toContain('discover-public-leads.py');

    const buttons = Array.from(target.querySelectorAll('button'));
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.textContent).toContain('Use workflow as goal');
    expect(buttons[1]?.textContent).toContain('Schedule workflow');

    act(() => {
      buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onUseAsGoal).toHaveBeenCalledTimes(1);
    const goal = onUseAsGoal.mock.calls[0]?.[0] as string;
    expect(goal).toContain('Run this public-data Lead Scout workflow from Cowork.');
    expect(goal).toContain('Target: architectes');
    expect(goal).toContain('Zone: Nantes');
    expect(goal).toContain('Automatic contact allowed: no');
    expect(goal).toContain('Search public candidates [search]');
    expect(goal).toContain('Do not send emails, submit forms, or contact leads.');

    act(() => {
      buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onScheduleGoal).toHaveBeenCalledTimes(1);
    expect(onScheduleGoal.mock.calls[0]?.[0]).toBe(goal);
    expect(onScheduleGoal.mock.calls[0]?.[1]).toMatchObject({
      leadDiscoveryWorkflowSurface: 'cowork',
      leadDiscoveryPublicDataOnly: true,
      leadDiscoveryContactPolicy: 'review_queue_only',
      leadDiscoveryStageCount: 7,
      leadDiscoveryArtifactCount: 7,
    });
  });
});
