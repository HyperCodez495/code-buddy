/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act, Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HermesMemoryProvidersStrip,
  type HermesMemoryProvidersReview,
} from '../src/renderer/components/hermes-memory-providers-strip';

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

const readyMemory: HermesMemoryProvidersReview = {
  activeProviderId: 'mem0',
  command: 'buddy hermes memory status --json',
  configuredRemoteCount: 1,
  fallbackCount: 2,
  generatedAt: '2026-05-31T12:00:00.000Z',
  issues: [],
  missingOfficialCount: 5,
  ok: true,
  providers: [
    {
      active: false,
      baseUrlSources: [],
      configured: true,
      credentialSources: [],
      id: 'local',
      label: 'Code Buddy local memory',
      local: true,
      notes: [],
      officialSurface: 'Built-in memory',
      registered: true,
      remediation: [],
      status: 'available',
    },
    {
      active: true,
      baseUrlSources: ['MEM0_BASE_URL'],
      configured: true,
      credentialSources: ['MEM0_API_KEY'],
      id: 'mem0',
      label: 'Mem0',
      local: false,
      notes: [],
      officialSurface: 'Mem0 external memory provider',
      registered: true,
      remediation: [],
      status: 'configured',
    },
    {
      active: false,
      baseUrlSources: [],
      configured: false,
      credentialSources: [],
      id: 'byterover',
      label: 'ByteRover',
      local: false,
      notes: [],
      officialSurface: 'ByteRover external memory provider',
      registered: false,
      remediation: [],
      status: 'missing',
    },
  ],
  recommendations: ['Missing official Hermes memory adapters: ByteRover.'],
  registeredCount: 4,
};

describe('HermesMemoryProvidersStrip', () => {
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

  it('renders active provider readiness and the safe CLI command', () => {
    const target = container();
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(HermesMemoryProvidersStrip, {
          readiness: readyMemory,
        }),
      );
    });

    const strip = target.querySelector('[data-testid="fleet-hermes-memory-providers"]');
    expect(strip?.textContent).toContain('Hermes memory providers');
    expect(strip?.textContent).toContain('memory ready');
    expect(strip?.textContent).toContain('mem0');
    expect(strip?.textContent).toContain('Mem0');
    expect(strip?.textContent).toContain('configured');
    expect(strip?.textContent).toContain('ByteRover');
    expect(strip?.textContent).toContain('missing');
    expect(strip?.textContent).toContain('buddy hermes memory status --json');
    expect(strip?.textContent).not.toContain('secret-mem0-token');
  });

  it('loads readiness from the readonly Electron bridge when no prop is provided', async () => {
    const target = container();
    const get = vi.fn().mockResolvedValue(readyMemory);
    (window as unknown as {
      electronAPI?: {
        tools?: {
          hermesMemoryProviders?: {
            get: typeof get;
          };
        };
      };
    }).electronAPI = {
      tools: {
        hermesMemoryProviders: {
          get,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(HermesMemoryProvidersStrip));
      await Promise.resolve();
    });

    expect(get).toHaveBeenCalledWith();
    expect(target.textContent).toContain('Mem0');
    expect(target.textContent).toContain('ByteRover');
  });

  it('runs a live probe through the Electron bridge and shows the verdict', async () => {
    const target = container();
    const probe = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        activeProviderId: 'mem0',
        fellBackToLocal: false,
        generatedAt: '2026-06-05T10:00:00.000Z',
        notes: [],
        ok: true,
        providerId: 'mem0',
        remote: true,
        retrieved: true,
        verdict: 'pass',
        wrote: true,
      },
    });
    (window as unknown as {
      electronAPI?: { tools?: { hermesMemoryProviders?: { probe: typeof probe } } };
    }).electronAPI = { tools: { hermesMemoryProviders: { probe } } };
    root = createRoot(target);

    act(() => {
      root?.render(React.createElement(HermesMemoryProvidersStrip, { readiness: readyMemory }));
    });

    const button = target.querySelector('[data-testid="hermes-memory-probe-mem0"]') as HTMLButtonElement;
    expect(button).not.toBeNull();

    await act(async () => {
      Simulate.click(button);
      await Promise.resolve();
    });

    expect(probe).toHaveBeenCalledWith({ providerId: 'mem0' });
    expect(
      target.querySelector('[data-testid="hermes-memory-probe-result-mem0"]')?.textContent,
    ).toContain('probe pass');
  });
});
