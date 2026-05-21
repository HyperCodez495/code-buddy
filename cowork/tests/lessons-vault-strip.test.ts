/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LessonsVaultStrip,
  buildLessonsVaultCommands,
  buildLessonsVaultGoal,
  type LessonsVaultPreview,
} from '../src/renderer/components/lessons-vault-strip';

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

const preview: LessonsVaultPreview = {
  commands: {
    exportVault: 'buddy lessons graph --no-keywords --vault .codebuddy/lessons-vault',
    graphJson: 'buddy lessons graph --no-keywords --json --graph-output .codebuddy/lessons-vault/graph.json',
    graphMarkdown: 'buddy lessons graph --no-keywords --markdown --graph-output .codebuddy/lessons-vault/_lessons.md',
  },
  concepts: [
    {
      id: 'contact-discovery',
      label: 'contact discovery',
      lessonCount: 2,
      path: 'concepts/contact-discovery.md',
      sources: ['wiki'],
    },
  ],
  counts: {
    concepts: 4,
    files: 12,
    lessons: 7,
    relations: 3,
  },
  generatedAt: '2026-05-19T01:00:00.000Z',
  kind: 'lessons_vault_preview',
  rootDir: 'D:/CascadeProjects/grok-cli-weekend',
  schemaVersion: 1,
  vaultDir: 'D:/CascadeProjects/grok-cli-weekend/.codebuddy/lessons-vault',
};

describe('LessonsVaultStrip', () => {
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

  it('renders lessons vault counts, concepts and a safe Fleet goal', () => {
    const target = container();
    const onUseAsGoal = vi.fn();
    root = createRoot(target);

    act(() => {
      root?.render(React.createElement(LessonsVaultStrip, {
        error: 'manifest unavailable',
        onUseAsGoal,
        preview,
      }));
    });

    const strip = target.querySelector('[data-testid="fleet-lessons-vault"]');
    expect(strip?.textContent).toContain('Lessons vault');
    expect(strip?.textContent).toContain('7 lessons · 4 concepts');
    expect(strip?.textContent).toContain('read-only');
    expect(strip?.textContent).toContain('no auto-lesson write');
    expect(strip?.textContent).toContain('Lessons vault preview failed');
    expect(strip?.textContent).toContain('manifest unavailable');
    expect(strip?.textContent).toContain('3 relations · 12 generated files');
    expect(strip?.textContent).toContain('contact discovery');
    expect(strip?.textContent).toContain('concepts/contact-discovery.md');
    expect(strip?.textContent).toContain('buddy lessons graph --no-keywords --vault .codebuddy/lessons-vault');

    const button = target.querySelector('button');
    expect(button?.textContent).toContain('Review vault as goal');

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onUseAsGoal).toHaveBeenCalledTimes(1);
    const goal = onUseAsGoal.mock.calls[0]?.[0] as string;
    expect(goal).toContain('Review and refresh the Code Buddy lessons vault from Cowork.');
    expect(goal).toContain('Current preview: 7 lessons, 4 concepts, 3 relations.');
    expect(goal).toContain('Do not auto-create lessons during vault export.');
  });

  it('keeps command and goal helpers aligned', () => {
    const commands = buildLessonsVaultCommands();
    const goal = buildLessonsVaultGoal(preview);

    expect(commands).toEqual([
      'buddy lessons graph --no-keywords --vault .codebuddy/lessons-vault',
      'buddy lessons graph --no-keywords --json --graph-output .codebuddy/lessons-vault/graph.json',
      'buddy lessons graph --no-keywords --markdown --graph-output .codebuddy/lessons-vault/_lessons.md',
    ]);
    for (const command of commands.slice(0, 2)) {
      expect(goal).toContain(command);
    }
  });

  it('loads the readonly preview from the Electron bridge when no preview is provided', async () => {
    const target = container();
    const previewLoader = vi.fn().mockResolvedValue(preview);
    (window as unknown as {
      electronAPI?: {
        tools?: {
          lessonsVault?: {
            preview: typeof previewLoader;
          };
        };
      };
    }).electronAPI = {
      tools: {
        lessonsVault: {
          preview: previewLoader,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(LessonsVaultStrip, { cwd: 'D:/CascadeProjects/grok-cli-weekend' }));
      await Promise.resolve();
    });

    expect(previewLoader).toHaveBeenCalledWith({
      cwd: 'D:/CascadeProjects/grok-cli-weekend',
      includeKeywords: false,
      limit: 20,
    });
    expect(target.textContent).toContain('contact discovery');
    expect(target.textContent).toContain('7 lessons · 4 concepts');
  });
});
