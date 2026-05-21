import { describe, expect, it } from 'vitest';
import { buildMobileSupervisionGatewayContract } from '../../src/observability/mobile-supervision-gateway-contract.js';
import { buildMobileSupervisionGatewayListenerShell } from '../../src/observability/mobile-supervision-gateway-listener-shell.js';
import {
  buildMobileSupervisionPairingAcceptancePlan,
  renderMobileSupervisionPairingAcceptancePlan,
} from '../../src/observability/mobile-supervision-pairing-acceptance-plan.js';
import { buildMobileSupervisionPairingState } from '../../src/observability/mobile-supervision-pairing-state.js';

describe('mobile supervision pairing acceptance plan', () => {
  it('builds a no-network acceptance plan without enabling mutations', async () => {
    const contract = await buildMobileSupervisionGatewayContract('mobile pair accept', {
      includeSnapshot: false,
      limit: 1,
    });
    const shell = buildMobileSupervisionGatewayListenerShell(contract);
    const pairingState = buildMobileSupervisionPairingState(shell, {
      deviceLabel: 'Patrice phone',
      now: '2026-05-18T23:30:00.000Z',
      previewCode: '123-456',
      ttlSeconds: 120,
    });
    const plan = buildMobileSupervisionPairingAcceptancePlan(pairingState, {
      localOperatorLabel: 'Patrice',
      now: '2026-05-18T23:31:00.000Z',
    });

    expect(plan).toMatchObject({
      kind: 'mobile_supervision_pairing_acceptance_plan',
      mode: 'acceptance_plan_only',
      query: 'mobile pair accept',
      basePath: '/api/mobile',
      pairing: {
        acceptedByListener: false,
        deviceLabel: 'Patrice phone',
        expiresAt: '2026-05-18T23:32:00.000Z',
        scopes: ['mobile:read', 'mobile:draft'],
        status: 'preview_only',
        tokenIssued: false,
      },
      acceptance: {
        canAcceptNow: false,
        localOperatorLabel: 'Patrice',
        status: 'blocked_until_listener_exists',
        endpoint: {
          action: 'accept_pairing_code',
          enabled: false,
          method: 'POST',
          path: '/api/mobile/pairing/accept',
        },
      },
      safety: {
        approvalMutationEndpointEnabled: false,
        autoAccept: false,
        localOnly: true,
        remoteExecutionDisabled: true,
        secretMaterialPersisted: false,
        serverStarted: false,
        tokenIssued: false,
      },
    });
    expect(plan.acceptance.requestId).toBe(`mobile-pairing-acceptance-${plan.pairing.codeFingerprint}`);
    expect(plan.preconditions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'preview_code_not_expired',
        passed: true,
      }),
      expect.objectContaining({
        id: 'loopback_listener_running',
        passed: false,
      }),
      expect.objectContaining({
        id: 'local_operator_confirmation',
        passed: false,
      }),
      expect.objectContaining({
        id: 'no_existing_secret_material',
        passed: true,
      }),
    ]));
    expect(plan.plannedMutations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        enabled: false,
        id: 'accept_pairing_session',
      }),
      expect.objectContaining({
        enabled: false,
        id: 'persist_pairing_session',
      }),
      expect.objectContaining({
        enabled: false,
        id: 'mint_short_lived_mobile_token',
      }),
      expect.objectContaining({
        enabled: false,
        id: 'enable_mobile_approval_mutations',
      }),
    ]));
  });

  it('renders acceptance preconditions and disabled mutation status', async () => {
    const contract = await buildMobileSupervisionGatewayContract('mobile pair accept', {
      includeSnapshot: false,
      limit: 1,
    });
    const shell = buildMobileSupervisionGatewayListenerShell(contract);
    const pairingState = buildMobileSupervisionPairingState(shell, {
      now: '2026-05-18T23:30:00.000Z',
      previewCode: '987654',
    });
    const rendered = renderMobileSupervisionPairingAcceptancePlan(
      buildMobileSupervisionPairingAcceptancePlan(pairingState, {
        now: '2026-05-18T23:31:00.000Z',
      }),
    );

    expect(rendered).toContain('Mobile supervision pairing acceptance plan');
    expect(rendered).toContain('Can accept now: false');
    expect(rendered).toContain('approvalMutationEndpointEnabled=false');
    expect(rendered).toContain('mint_short_lived_mobile_token: enabled=false');
  });
});
