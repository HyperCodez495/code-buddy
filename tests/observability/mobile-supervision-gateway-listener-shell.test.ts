import { describe, expect, it } from 'vitest';
import { buildMobileSupervisionGatewayContract } from '../../src/observability/mobile-supervision-gateway-contract.js';
import {
  buildMobileSupervisionGatewayListenerShell,
  renderMobileSupervisionGatewayListenerShell,
} from '../../src/observability/mobile-supervision-gateway-listener-shell.js';

describe('mobile supervision gateway listener shell', () => {
  it('builds a disabled local listener shell from the gateway contract', async () => {
    const contract = await buildMobileSupervisionGatewayContract('mobile listener', {
      includeSnapshot: false,
      limit: 1,
    });

    const shell = buildMobileSupervisionGatewayListenerShell(contract);

    expect(shell).toMatchObject({
      kind: 'mobile_gateway_listener_shell',
      mode: 'disabled_shell',
      bind: {
        host: '127.0.0.1',
        networkExposure: 'loopback_only',
        port: 0,
        status: 'not_started',
      },
      safety: {
        localOperatorRequiredForDrafts: true,
        mutationRoutesDisabled: true,
        outreachDisabled: true,
        remoteExecutionDisabled: true,
        serverStarted: false,
      },
      transport: {
        listener: 'not_started',
        remoteExecution: 'disabled',
      },
    });
    expect(shell.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'view_run_summary',
          handler: 'read_only_stub',
          sideEffects: 'none',
          status: 'planned_not_bound',
        }),
        expect.objectContaining({
          action: 'draft_followup_prompt',
          handler: 'local_operator_review_stub',
          localApprovalRequired: true,
          sideEffects: 'draft_only',
        }),
      ]),
    );
    expect(shell.blockedRoutes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'execute_tool',
          handler: 'blocked_stub',
          status: 'blocked_by_policy',
        }),
      ]),
    );
    expect(shell.acceptanceChecks.join('\n')).toContain('No HTTP server is started');
  });

  it('renders the disabled listener posture for operator review', async () => {
    const contract = await buildMobileSupervisionGatewayContract('mobile listener', {
      includeSnapshot: false,
      limit: 1,
    });
    const rendered = renderMobileSupervisionGatewayListenerShell(
      buildMobileSupervisionGatewayListenerShell(contract),
    );

    expect(rendered).toContain('Mobile supervision gateway listener shell');
    expect(rendered).toContain('Mode: disabled_shell');
    expect(rendered).toContain('Bind: 127.0.0.1:0 (not_started, loopback_only)');
    expect(rendered).toContain('POST /api/mobile/followup-draft -> local_operator_review_stub');
    expect(rendered).toContain('Execution, mutation, outreach, secret-read and push operations stay blocked');
  });
});
