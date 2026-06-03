import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import { getHermesMobileSupervisionForReview } from '../src/main/tools/hermes-mobile-supervision-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('Hermes mobile supervision bridge', () => {
  it('summarizes the mobile contract without exposing pairing codes', async () => {
    mockedLoadCoreModule.mockImplementation(async (relativePath: string) => {
      if (relativePath === 'observability/mobile-supervision-gateway-contract.js') {
        return {
          buildMobileSupervisionGatewayContract: vi.fn(async () => ({
            auth: {
              scheme: 'bearer_or_pairing_code',
              scopes: ['mobile:read', 'mobile:draft'],
              ttlSeconds: 900,
            },
            basePath: '/api/mobile',
            blockedOperations: [
              {
                action: 'execute_tool',
                policy: { reason: 'Remote execution disabled.' },
              },
            ],
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
            generatedAt: '2026-05-31T15:40:00.000Z',
            query: 'mobile supervision',
            transport: {
              exposure: 'local_first',
              offDeviceTlsRequired: true,
              remoteExecution: 'disabled',
            },
          })),
        };
      }
      if (relativePath === 'observability/mobile-supervision-gateway-listener-shell.js') {
        return {
          buildMobileSupervisionGatewayListenerShell: vi.fn(() => ({
            bind: { host: '127.0.0.1', networkExposure: 'loopback_only', port: 0, status: 'not_started' },
          })),
        };
      }
      if (relativePath === 'observability/mobile-supervision-pairing-state.js') {
        return {
          buildMobileSupervisionPairingState: vi.fn(() => ({
            pairing: {
              deviceLabel: 'Cowork mobile supervisor',
              deviceLabelMaxChars: 120,
              previewCode: '123456',
              scopes: ['mobile:read', 'mobile:draft'],
              status: 'preview_only',
              tokenIssued: false,
              ttlSeconds: 300,
            },
          })),
        };
      }
      if (relativePath === 'observability/mobile-supervision-approval-queue.js') {
        return {
          buildMobileSupervisionApprovalQueue: vi.fn(() => ({
            counts: {
              blocked: 1,
              pending: 1,
              ready: 1,
              total: 3,
            },
            safety: {
              autoDispatch: false,
              localOnly: true,
              remoteExecutionDisabled: true,
            },
          })),
        };
      }
      return null;
    });

    const summary = await getHermesMobileSupervisionForReview();

    expect(summary).toMatchObject({
      command: 'buddy hermes mobile status "mobile supervision" --json',
      ok: true,
      routeMount: {
        basePath: '/api/mobile',
        serverCommand: 'buddy server --port 3000',
      },
      summary: {
        blockedOperations: 1,
        draftOnlyEndpoints: 1,
        readOnlyEndpoints: 1,
      },
      approvalQueue: {
        autoDispatch: false,
        localOnly: true,
        remoteExecutionDisabled: true,
      },
      pairing: {
        deviceLabelMaxChars: 120,
        status: 'preview_only',
        tokenIssued: false,
      },
    });
    expect(JSON.stringify(summary)).not.toContain('123456');
    expect(JSON.stringify(summary)).not.toContain('previewCode');
  });

  it('degrades to null when a core module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);

    await expect(getHermesMobileSupervisionForReview()).resolves.toBeNull();
  });
});
