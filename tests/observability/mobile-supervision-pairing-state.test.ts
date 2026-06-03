import { describe, expect, it } from 'vitest';
import { buildMobileSupervisionGatewayContract } from '../../src/observability/mobile-supervision-gateway-contract.js';
import { buildMobileSupervisionGatewayListenerShell } from '../../src/observability/mobile-supervision-gateway-listener-shell.js';
import {
  MOBILE_SUPERVISION_DEVICE_LABEL_MAX_CHARS,
  buildMobileSupervisionPairingState,
  renderMobileSupervisionPairingState,
} from '../../src/observability/mobile-supervision-pairing-state.js';

describe('mobile supervision pairing state', () => {
  it('builds a preview-only pairing state without starting a listener', async () => {
    const contract = await buildMobileSupervisionGatewayContract('mobile pair', {
      includeSnapshot: false,
      limit: 1,
    });
    const shell = buildMobileSupervisionGatewayListenerShell(contract);

    const state = buildMobileSupervisionPairingState(shell, {
      deviceLabel: 'Patrice phone',
      now: '2026-05-18T23:30:00.000Z',
      previewCode: '123-456',
      ttlSeconds: 120,
    });

    expect(state).toMatchObject({
      kind: 'mobile_supervision_pairing_state',
      mode: 'local_pairing_plan',
      pairing: {
        acceptedByListener: false,
        deviceLabel: 'Patrice phone',
        deviceLabelMaxChars: MOBILE_SUPERVISION_DEVICE_LABEL_MAX_CHARS,
        expiresAt: '2026-05-18T23:32:00.000Z',
        persisted: false,
        previewCode: '123456',
        scopes: ['mobile:read', 'mobile:draft'],
        status: 'preview_only',
        tokenIssued: false,
        ttlSeconds: 120,
      },
      listener: {
        bindStatus: 'not_started',
        listenerStatus: 'not_started',
        networkExposure: 'loopback_only',
        serverStarted: false,
      },
      safety: {
        approvalMutationsDisabled: true,
        notAcceptedByAnyServer: true,
        pairingRequiresLocalOperator: true,
        remoteExecutionDisabled: true,
        secretMaterialPersisted: false,
      },
    });
    expect(state.pairing.codeFingerprint).toMatch(/^[a-f0-9]{16}$/);
  });

  it('keeps preview device labels within the real pairing route limit', async () => {
    const contract = await buildMobileSupervisionGatewayContract('mobile pair', {
      includeSnapshot: false,
      limit: 1,
    });
    const shell = buildMobileSupervisionGatewayListenerShell(contract);
    const longLabel = `phone-${'😀'.repeat(140)}`;

    const state = buildMobileSupervisionPairingState(shell, {
      deviceLabel: longLabel,
    });

    expect(Array.from(state.pairing.deviceLabel)).toHaveLength(MOBILE_SUPERVISION_DEVICE_LABEL_MAX_CHARS);
    expect(state.pairing.deviceLabelMaxChars).toBe(MOBILE_SUPERVISION_DEVICE_LABEL_MAX_CHARS);
  });

  it('renders the local operator pairing checklist', async () => {
    const contract = await buildMobileSupervisionGatewayContract('mobile pair', {
      includeSnapshot: false,
      limit: 1,
    });
    const shell = buildMobileSupervisionGatewayListenerShell(contract);
    const rendered = renderMobileSupervisionPairingState(
      buildMobileSupervisionPairingState(shell, {
        now: '2026-05-18T23:30:00.000Z',
        previewCode: '987654',
      }),
    );

    expect(rendered).toContain('Mobile supervision pairing state');
    expect(rendered).toContain('Status: preview_only');
    expect(rendered).toContain('Code: 987654');
    expect(rendered).toContain(`Device label limit: ${MOBILE_SUPERVISION_DEVICE_LABEL_MAX_CHARS} characters`);
    expect(rendered).toContain('serverStarted=false');
    expect(rendered).toContain('Do not accept the code from a phone until a real loopback listener is explicitly started.');
    expect(rendered).toContain('oversized labels are rejected before token minting');
  });
});
