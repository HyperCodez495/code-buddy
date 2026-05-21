/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ToolProfileInspectorStrip,
  getBlockedMutationExecutionTools,
  summarizeToolProfileDecisions,
} from '../src/renderer/components/tool-profile-inspector-strip';
import { buildHermesToolsetDescriptor } from '../../src/fleet/dispatch-profile.js';

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

describe('ToolProfileInspectorStrip', () => {
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

  it('renders the selected Hermes tool profile with effective decisions', () => {
    const target = container();
    root = createRoot(target);

    act(() => {
      root?.render(React.createElement(ToolProfileInspectorStrip, { profile: 'safe' }));
    });

    const strip = target.querySelector('[data-testid="fleet-tool-profile-inspector"]');
    expect(strip?.textContent).toContain('Tool profile');
    expect(strip?.textContent).toContain('fleet.hermes.safe');
    expect(strip?.textContent).toContain('2 allow');
    expect(strip?.textContent).toContain('1 confirm');
    expect(strip?.textContent).toContain('4 deny');
    expect(strip?.textContent).toContain('read-only by default');
    expect(strip?.textContent).toContain('view_file allow');
    expect(strip?.textContent).toContain('web_fetch confirm');
    expect(strip?.textContent).toContain('create_file deny');
    expect(strip?.textContent).toContain('bash deny');

    const blockedRisk = target.querySelector('[data-testid="fleet-tool-profile-blocked-risk"]');
    expect(blockedRisk?.textContent).toContain('Blocked mutation/execution');
    expect(blockedRisk?.textContent).toContain('create_file');
    expect(blockedRisk?.textContent).toContain('bash');
    expect(blockedRisk?.textContent).toContain('git_push');
    expect(blockedRisk?.textContent).toContain('delete_file');
    expect(blockedRisk?.textContent).not.toContain('web_fetch');
  });

  it('summarizes descriptor decisions for profile badges', () => {
    const toolset = buildHermesToolsetDescriptor('code', [
      'view_file',
      'create_file',
      'bash',
      'git_push',
    ]);

    expect(summarizeToolProfileDecisions(toolset)).toEqual({
      allow: 2,
      confirm: 2,
      deny: 0,
    });
  });

  it('extracts denied mutation and execution tools for visible risk summaries', () => {
    const toolset = buildHermesToolsetDescriptor('review', [
      'view_file',
      'web_fetch',
      'create_file',
      'bash',
      'git_push',
      'delete_file',
    ]);

    const blockedTools = getBlockedMutationExecutionTools(toolset.decisions);

    expect(blockedTools).toEqual(['create_file', 'bash', 'git_push', 'delete_file']);
    expect(blockedTools).not.toContain('web_fetch');
  });
});
