/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HermesMobileSupervisionStrip,
  type HermesMobileSupervisionReview,
} from '../src/renderer/components/hermes-mobile-supervision-strip';

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

const readyMobileStatus: HermesMobileSupervisionReview = {
  approvalQueue: {
    autoDispatch: false,
    counts: {
      blocked: 6,
      pending: 1,
      ready: 3,
      total: 10,
    },
    localOnly: true,
    remoteExecutionDisabled: true,
  },
  auth: {
    scheme: 'bearer_or_pairing_code',
    scopes: ['mobile:read', 'mobile:draft'],
    ttlSeconds: 900,
  },
  blockedOperations: [{ action: 'execute_tool', reason: 'Remote execution disabled.' }],
  command: 'buddy hermes mobile status "mobile supervision" --json',
  endpoints: [
    {
      action: 'view_run_summary',
      id: 'mobile.snapshot.read',
      localApprovalRequired: false,
      method: 'GET',
      path: '/api/mobile/snapshot',
      sideEffects: 'none',
    },
    {
      action: 'draft_followup_prompt',
      id: 'mobile.followup.draft',
      localApprovalRequired: true,
      method: 'POST',
      path: '/api/mobile/followup-draft',
      sideEffects: 'draft_only',
    },
  ],
  ok: true,
  pairing: {
    deviceLabel: 'Cowork mobile supervisor',
    scopes: ['mobile:read', 'mobile:draft'],
    status: 'preview_only',
    tokenIssued: false,
    ttlSeconds: 300,
  },
  query: 'mobile supervision',
  recommendations: ['Start the embedded server before pairing a phone.'],
  routeMount: {
    basePath: '/api/mobile',
    serverCommand: 'buddy server --port 3000',
    status: 'implemented_not_probed',
  },
  summary: {
    blockedOperations: 6,
    draftOnlyEndpoints: 1,
    pendingLocalApproval: 1,
    readOnlyEndpoints: 3,
    readyReadOnly: 3,
  },
  transport: {
    offDeviceTlsRequired: true,
    remoteExecution: 'disabled',
  },
};

describe('HermesMobileSupervisionStrip', () => {
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

  it('renders review-only mobile readiness and the safe CLI command', () => {
    const target = container();
    root = createRoot(target);

    act(() => {
      root?.render(React.createElement(HermesMobileSupervisionStrip, { status: readyMobileStatus }));
    });

    const strip = target.querySelector('[data-testid="fleet-hermes-mobile-supervision"]');
    expect(strip?.textContent).toContain('Hermes mobile supervision');
    expect(strip?.textContent).toContain('mobile ready');
    expect(strip?.textContent).toContain('/api/mobile/snapshot');
    expect(strip?.textContent).toContain('/api/mobile/followup-draft');
    expect(strip?.textContent).toContain('draft_followup_prompt');
    expect(strip?.textContent).toContain('remote execution disabled');
    expect(strip?.textContent).toContain('buddy hermes mobile status "mobile supervision" --json');
    expect(strip?.textContent).not.toContain('123456');
    expect(strip?.textContent).not.toContain('previewCode');
  });

  it('loads readiness from the readonly Electron bridge when no prop is provided', async () => {
    const target = container();
    const get = vi.fn().mockResolvedValue(readyMobileStatus);
    (window as unknown as {
      electronAPI?: {
        tools?: {
          hermesMobileSupervision?: {
            get: typeof get;
          };
        };
      };
    }).electronAPI = {
      tools: {
        hermesMobileSupervision: {
          get,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(HermesMobileSupervisionStrip));
      await Promise.resolve();
    });

    expect(get).toHaveBeenCalledWith({ query: 'mobile supervision' });
    expect(target.textContent).toContain('/api/mobile/snapshot');
    expect(target.textContent).toContain('queue 3/10 ready');
  });
});
