import { describe, expect, it } from 'vitest';
import { buildMobileSupervisionGatewayContract } from '../../src/observability/mobile-supervision-gateway-contract.js';
import { buildMobileSupervisionGatewayListenerShell } from '../../src/observability/mobile-supervision-gateway-listener-shell.js';
import {
  buildMobileSupervisionApprovalQueue,
  renderMobileSupervisionApprovalQueue,
} from '../../src/observability/mobile-supervision-approval-queue.js';
import { buildMobileSupervisionPairingState } from '../../src/observability/mobile-supervision-pairing-state.js';

describe('mobile supervision approval queue', () => {
  it('collects read-only, pending and blocked mobile review items without dispatch', async () => {
    const contract = await buildMobileSupervisionGatewayContract('mobile approval queue', {
      includeSnapshot: false,
      limit: 1,
    });
    const shell = buildMobileSupervisionGatewayListenerShell(contract);
    const pairing = buildMobileSupervisionPairingState(shell, {
      now: '2026-05-19T00:00:00.000Z',
      previewCode: '112233',
    });

    const queue = buildMobileSupervisionApprovalQueue(contract, pairing);

    expect(queue).toMatchObject({
      kind: 'mobile_supervision_approval_queue',
      mode: 'local_review_queue',
      pairing: {
        status: 'preview_only',
        tokenIssued: false,
      },
      listener: {
        listenerStatus: 'not_started',
        serverStarted: false,
      },
      safety: {
        approvalMutationEndpointEnabled: false,
        autoDispatch: false,
        localOnly: true,
        remoteExecutionDisabled: true,
      },
    });
    expect(queue.counts).toEqual({
      blocked: 6,
      pending: 1,
      ready: 3,
      total: 10,
    });
    expect(queue.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'view_run_summary',
          canDispatch: false,
          status: 'ready_read_only',
        }),
        expect.objectContaining({
          action: 'draft_followup_prompt',
          canDispatch: false,
          operatorActions: ['approve_draft', 'cancel_draft'],
          status: 'pending_local_operator',
        }),
        expect.objectContaining({
          action: 'execute_tool',
          canDispatch: false,
          operatorActions: ['reject'],
          status: 'blocked_by_policy',
        }),
      ]),
    );
    const pending = queue.items.find((item) => item.status === 'pending_local_operator');
    expect(pending?.reviewDraft).toEqual(expect.objectContaining({
      status: 'needs_local_operator',
    }));
  });

  it('renders the approval queue safety posture', async () => {
    const contract = await buildMobileSupervisionGatewayContract('mobile approval queue', {
      includeSnapshot: false,
      limit: 1,
    });
    const shell = buildMobileSupervisionGatewayListenerShell(contract);
    const pairing = buildMobileSupervisionPairingState(shell, {
      now: '2026-05-19T00:00:00.000Z',
      previewCode: '112233',
    });
    const rendered = renderMobileSupervisionApprovalQueue(
      buildMobileSupervisionApprovalQueue(contract, pairing),
    );

    expect(rendered).toContain('Mobile supervision approval queue');
    expect(rendered).toContain('Pairing: preview_only, tokenIssued=false');
    expect(rendered).toContain('Listener: not_started, serverStarted=false');
    expect(rendered).toContain('pending_local_operator: POST /api/mobile/followup-draft -> draft_followup_prompt');
    expect(rendered).toContain('autoDispatch=false');
  });
});
