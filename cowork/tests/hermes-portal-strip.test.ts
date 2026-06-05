/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HermesPortalStrip, type HermesPortalReview } from '../src/renderer/components/hermes-portal-strip';

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

const readyPortal: HermesPortalReview = {
  command: 'buddy hermes portal status --json',
  configuredToolCount: 2,
  generatedAt: '2026-06-05T10:00:00.000Z',
  loggedIn: true,
  managedByNousCount: 1,
  notConfiguredToolCount: 0,
  notes: ['Portal is ready.'],
  ok: true,
  portal: {
    authFilePresent: true,
    credentialPresent: true,
    credentialSources: ['nous-auth.json'],
    docsUrl: 'https://hermes-agent.nousresearch.com/docs',
    portalBaseUrl: 'https://portal.nousresearch.com',
    selectedInferenceProvider: 'nous',
    selectedModel: 'hermes-4',
    selectedViaNous: true,
    subscriptionUrl: 'https://portal.nousresearch.com/manage-subscription',
    toolGatewayConfigured: true,
    toolGatewayUrl: 'https://gateway.nousresearch.com',
  },
  routingActive: true,
  tools: [
    {
      configured: true,
      credentialEnv: ['FIRECRAWL_API_KEY'],
      currentProvider: 'firecrawl',
      key: 'web',
      label: 'Web search',
      managedByNous: false,
      notes: [],
      partner: 'Firecrawl',
    },
  ],
};

describe('HermesPortalStrip', () => {
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

  it('renders portal readiness, gateway tools, and the CLI command', () => {
    const target = container();
    root = createRoot(target);

    act(() => {
      root?.render(React.createElement(HermesPortalStrip, { readiness: readyPortal }));
    });

    const strip = target.querySelector('[data-testid="fleet-hermes-portal"]');
    expect(strip?.textContent).toContain('Hermes Nous Portal');
    expect(strip?.textContent).toContain('portal ready');
    expect(strip?.textContent).toContain('logged in');
    expect(strip?.textContent).toContain('Web search');
    expect(strip?.textContent).toContain('Firecrawl');
    expect(strip?.textContent).toContain('nous-auth.json');
    expect(strip?.textContent).toContain('buddy hermes portal status --json');
  });

  it('loads portal readiness from the readonly Electron bridge when no prop is provided', async () => {
    const target = container();
    const get = vi.fn().mockResolvedValue(readyPortal);
    (window as unknown as {
      electronAPI?: { tools?: { hermesPortal?: { get: typeof get } } };
    }).electronAPI = {
      tools: { hermesPortal: { get } },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(HermesPortalStrip));
      await Promise.resolve();
    });

    expect(get).toHaveBeenCalledWith();
    expect(target.textContent).toContain('Web search');
  });
});
