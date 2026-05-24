/**
 * @vitest-environment happy-dom
 *
 * GAP-8 — the lessons vault cockpit (LessonsVaultGraph) used to be imported
 * nowhere ("dead UI"). These tests pin the component's render contract now that
 * FleetCommandCenter mounts it, so it cannot silently rot back into dead code.
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LessonsVaultGraph } from '../src/renderer/components/LessonsVaultGraph';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

const lessons = [
  { id: 'l1', title: 'Prefer functional components', tags: ['react'], summary: 'Use hooks' },
  { id: 'l2', title: 'Strict null checks', tags: ['typescript'], summary: 'Turn on strict' },
];

describe('LessonsVaultGraph (GAP-8 mount)', () => {
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
    document.body.replaceChildren();
  });

  it('renders the vault modal and the lessons returned by the bridge', async () => {
    const target = container();
    const previewLoader = vi.fn().mockResolvedValue(lessons);
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      tools: { lessonsVault: { preview: previewLoader } },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(LessonsVaultGraph, { onClose: vi.fn() }));
      await Promise.resolve();
    });

    const modal = target.querySelector('[data-testid="lessons-vault-graph"]');
    expect(modal).not.toBeNull();
    expect(previewLoader).toHaveBeenCalledTimes(1);
    expect(target.textContent).toContain('Prefer functional components');
    expect(target.textContent).toContain('Strict null checks');
    // grouped by tag
    expect(target.textContent).toContain('react');
    expect(target.textContent).toContain('typescript');
  });

  it('invokes onClose when the Escape key is pressed', async () => {
    const target = container();
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      tools: { lessonsVault: { preview: vi.fn().mockResolvedValue([]) } },
    };
    const onClose = vi.fn();
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(LessonsVaultGraph, { onClose }));
      await Promise.resolve();
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders an empty state without crashing when there are no lessons', async () => {
    const target = container();
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      tools: { lessonsVault: { preview: vi.fn().mockResolvedValue([]) } },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(LessonsVaultGraph, { onClose: vi.fn() }));
      await Promise.resolve();
    });

    expect(target.querySelector('[data-testid="lessons-vault-graph"]')).not.toBeNull();
    expect(target.textContent).toContain('No lessons yet');
  });
});
