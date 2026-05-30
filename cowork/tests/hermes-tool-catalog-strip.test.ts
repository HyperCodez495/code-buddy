/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HermesToolCatalogStrip,
  buildHermesToolCatalogCommand,
} from '../src/renderer/components/hermes-tool-catalog-strip';

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

describe('HermesToolCatalogStrip', () => {
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

  it('renders Hermes tool parity counts and prioritized gaps', () => {
    const target = container();
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(HermesToolCatalogStrip, {
          catalog: {
            generatedAt: '2026-05-30T16:30:00.000Z',
            inspectedCommit: '5f84c914',
            localToolCount: 120,
            source: 'https://github.com/NousResearch/hermes-agent',
            summary: {
              exact: 22,
              gaps: 33,
              nativeEquivalent: 6,
              partial: 10,
              total: 71,
            },
            topWork: [
              {
                category: 'skills',
                name: 'skill_manage',
                nextWork: 'Expose Cowork lifecycle controls.',
                status: 'partial',
                toolset: 'hermes-core',
              },
              {
                category: 'runtime',
                name: 'execute_code',
                nextWork: 'Make a product/security decision.',
                status: 'gap',
                toolset: 'hermes-core',
              },
            ],
          },
          error: 'catalog unavailable',
        }),
      );
    });

    const strip = target.querySelector('[data-testid="fleet-hermes-tool-catalog"]');
    expect(strip?.textContent).toContain('Hermes tool catalog');
    expect(strip?.textContent).toContain('28/71 covered');
    expect(strip?.textContent).toContain('22 exact');
    expect(strip?.textContent).toContain('6 native');
    expect(strip?.textContent).toContain('10 partial');
    expect(strip?.textContent).toContain('33 gaps');
    expect(strip?.textContent).toContain('Hermes tool catalog load failed');
    expect(strip?.textContent).toContain('catalog unavailable');
    expect(strip?.textContent).toContain('skill_manage');
    expect(strip?.textContent).toContain('execute_code');
    expect(strip?.textContent).toContain('Make a product/security decision.');
    expect(strip?.textContent).toContain('buddy hermes tools --json');
  });

  it('keeps the CLI helper command stable', () => {
    expect(buildHermesToolCatalogCommand()).toBe('buddy hermes tools --json');
  });

  it('loads the catalog from the readonly Electron bridge when no catalog is provided', async () => {
    const target = container();
    const get = vi.fn().mockResolvedValue({
      generatedAt: '2026-05-30T16:35:00.000Z',
      inspectedCommit: '5f84c914',
      localToolCount: 120,
      source: 'https://github.com/NousResearch/hermes-agent',
      summary: {
        exact: 22,
        gaps: 33,
        nativeEquivalent: 6,
        partial: 10,
        total: 71,
      },
      topWork: [
        {
          category: 'media',
          name: 'vision_analyze',
          status: 'partial',
          toolset: 'hermes-core',
        },
      ],
    });
    (window as unknown as {
      electronAPI?: {
        tools?: {
          hermesCatalog?: {
            get: typeof get;
          };
        };
      };
    }).electronAPI = {
      tools: {
        hermesCatalog: {
          get,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(HermesToolCatalogStrip));
      await Promise.resolve();
    });

    expect(get).toHaveBeenCalledWith();
    expect(target.textContent).toContain('vision_analyze');
    expect(target.textContent).toContain('28/71 covered');
  });
});
