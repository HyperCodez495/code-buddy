import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const companionPanelPath = path.resolve(__dirname, '../src/renderer/components/CompanionPanel.tsx');
const preloadPath = path.resolve(__dirname, '../src/preload/index.ts');

describe('companion gateway Fleet launch surface', () => {
  it('keeps gateway Fleet launch operator-approved and routed through fleet.dispatch', () => {
    const source = readFileSync(companionPanelPath, 'utf8');

    expect(source).toContain('Launch Fleet');
    expect(source).toContain('window.confirm(');
    expect(source).toContain('This will not send an outbound channel reply.');
    expect(source).toContain('window.electronAPI.fleet.dispatch(draft.dispatchInput)');
    expect(source).toContain("setBusyAction('gatewayFleetLaunch')");
    expect(source).toContain('gatewayFleetLaunch?.ok');
  });

  it('allows Fleet dispatch metadata needed by gateway handoffs through preload types', () => {
    const source = readFileSync(preloadPath, 'utf8');

    expect(source).toContain('deliveryChannel?: string;');
    expect(source).toContain('sourceSessionId?: string;');
    expect(source).toContain("privacyTag?: 'public' | 'sensitive';");
    expect(source).toContain('lintWarning?: string;');
  });

  it('keeps outbound channel replies as local drafts instead of direct sends', () => {
    const panel = readFileSync(companionPanelPath, 'utf8');
    const preload = readFileSync(preloadPath, 'utf8');

    expect(panel).toContain('Reply draft');
    expect(panel).toContain('window.prompt(');
    expect(panel).toContain('draftGatewayOutboundReply');
    expect(panel).toContain('companion-gateway-outbound-reply-draft');
    expect(panel).toContain('not sent');
    expect(preload).toContain('companion.gateway.outboundReplyDraft');
    expect(preload).toContain('replyDraft?: CompanionGatewayOutboundReplyDraft');
  });

  it('requires explicit confirmation before sending approved gateway replies', () => {
    const panel = readFileSync(companionPanelPath, 'utf8');
    const preload = readFileSync(preloadPath, 'utf8');

    expect(panel).toContain('Send reply');
    expect(panel).toContain('sendGatewayOutboundReply');
    expect(panel).toContain('This may contact the external recipient.');
    expect(panel).toContain('liveDeliveryConfirmed: true');
    expect(panel).toContain('companion-gateway-outbound-reply-send');
    expect(preload).toContain('companion.gateway.sendOutboundReply');
    expect(preload).toContain('result?: CompanionGatewayOutboundReplySendResult');
  });

  it('surfaces gateway lifecycle diagnostics in the Companion panel', () => {
    const panel = readFileSync(companionPanelPath, 'utf8');
    const preload = readFileSync(preloadPath, 'utf8');

    expect(panel).toContain('Gateway lifecycle');
    expect(panel).toContain('companion-gateway-lifecycle');
    expect(panel).toContain('gatewayLifecycle');
    expect(panel).toContain('readyChannelCount');
    expect(panel).toContain('attentionChannelCount');
    expect(preload).toContain('companion.gateway.lifecycle');
    expect(preload).toContain('report?: CompanionGatewayLifecycleReport');
  });

  it('surfaces gateway admin plans and replay diagnostics in the Companion panel', () => {
    const panel = readFileSync(companionPanelPath, 'utf8');
    const preload = readFileSync(preloadPath, 'utf8');

    expect(panel).toContain('Gateway admin');
    expect(panel).toContain('companion-gateway-admin-plan');
    expect(panel).toContain('gatewayAdminPlan');
    expect(panel).toContain('executeGatewayAdminAction');
    expect(panel).toContain('companion-gateway-admin-execution');
    expect(panel).toContain('replayablePreviewCount');
    expect(panel).toContain('executesChannelAdmin');
    expect(panel).toContain('liveAdminConfirmed: true');
    expect(preload).toContain('companion.gateway.adminPlan');
    expect(preload).toContain('companion.gateway.executeAdminAction');
    expect(preload).toContain('plan?: CompanionGatewayAdminPlan');
    expect(preload).toContain('result?: CompanionGatewayAdminExecutionResult');
  });
});
