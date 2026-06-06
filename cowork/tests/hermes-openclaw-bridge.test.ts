import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import {
  attachOpenClawBridgeForReview,
  draftOpenClawBridgeHandoffForReview,
  getOpenClawBridgeStatusForReview,
  previewOpenClawBridgeAttachForReview,
  previewOpenClawBridgeSendForReview,
  sendOpenClawBridgeResponseForReview,
} from '../src/main/tools/hermes-openclaw-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('Hermes OpenClaw gateway bridge', () => {
  it('loads the core bridge and returns secret-safe status descriptors', async () => {
    const discovery = { detected: true, tokenPresent: true, tokenPreview: '<redacted>', endpoint: 'http://127.0.0.1:7777' };
    const descriptor = { id: 'openclaw-local', capabilities: ['chat', 'handoff'] };
    const discoverOpenClawGateway = vi.fn().mockResolvedValue(discovery);
    const buildOpenClawNodeDescriptor = vi.fn().mockReturnValue(descriptor);
    mockedLoadCoreModule.mockResolvedValue({ discoverOpenClawGateway, buildOpenClawNodeDescriptor });

    const result = await getOpenClawBridgeStatusForReview({ cwd: '/repo', source: '/home/u/.openclaw' });

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('openclaw/gateway-bridge.js');
    expect(discoverOpenClawGateway).toHaveBeenCalledWith({ cwd: '/repo', home: '/home/u/.openclaw' });
    expect(buildOpenClawNodeDescriptor).toHaveBeenCalledWith(discovery, { cwd: '/repo' });
    expect(result).toEqual({ ok: true, discovery, descriptor });
  });

  it('previews attach in dry-run mode', async () => {
    const attachOpenClawGateway = vi.fn().mockResolvedValue({ dryRun: true, status: 'preview' });
    mockedLoadCoreModule.mockResolvedValue({ attachOpenClawGateway });

    const result = await previewOpenClawBridgeAttachForReview({ cwd: '/repo', endpointPath: '/api/attach' });

    expect(attachOpenClawGateway).toHaveBeenCalledWith(
      { dryRun: true, endpointPath: '/api/attach' },
      { cwd: '/repo', home: undefined },
    );
    expect(result.ok).toBe(true);
    expect(result.result?.dryRun).toBe(true);
  });

  it('refuses live attach without an approver', async () => {
    const attachOpenClawGateway = vi.fn();
    mockedLoadCoreModule.mockResolvedValue({ attachOpenClawGateway });

    const result = await attachOpenClawBridgeForReview({ approvedBy: '   ' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/approvedBy is required/);
    expect(attachOpenClawGateway).not.toHaveBeenCalled();
  });

  it('runs live attach only with explicit confirmation flags', async () => {
    const attachOpenClawGateway = vi.fn().mockResolvedValue({ dryRun: false, status: 'attached' });
    mockedLoadCoreModule.mockResolvedValue({ attachOpenClawGateway });

    const result = await attachOpenClawBridgeForReview({
      approvedBy: 'Patrice',
      cwd: '/repo',
      endpointPath: '/api/attach',
      source: '/home/u/.openclaw',
    });

    expect(attachOpenClawGateway).toHaveBeenCalledWith(
      {
        approvedBy: 'Patrice',
        dryRun: false,
        endpointPath: '/api/attach',
        liveAttachConfirmed: true,
      },
      { cwd: '/repo', home: '/home/u/.openclaw' },
    );
    expect(result.result?.status).toBe('attached');
  });

  it('drafts a Fleet handoff without direct dispatch', async () => {
    const prepareOpenClawFleetHandoffDraft = vi.fn().mockResolvedValue({
      autoDispatch: false,
      draftFile: '/repo/.codebuddy/openclaw/bridge/msg-1.fleet.json',
      kind: 'openclaw_fleet_handoff_draft',
    });
    mockedLoadCoreModule.mockResolvedValue({ prepareOpenClawFleetHandoffDraft });

    const result = await draftOpenClawBridgeHandoffForReview({
      channel: 'slack',
      cwd: '/repo',
      messageId: 'msg-1',
      senderId: 'u-1',
      text: 'please inspect this',
      threadId: 't-1',
    });

    expect(prepareOpenClawFleetHandoffDraft).toHaveBeenCalledWith(
      {
        channel: 'slack',
        messageId: 'msg-1',
        senderId: 'u-1',
        senderName: undefined,
        text: 'please inspect this',
        threadId: 't-1',
      },
      { cwd: '/repo' },
    );
    expect(result.result?.autoDispatch).toBe(false);
  });

  it('previews send in dry-run mode', async () => {
    const sendOpenClawResponse = vi.fn().mockResolvedValue({ dryRun: true, status: 'preview' });
    mockedLoadCoreModule.mockResolvedValue({ sendOpenClawResponse });

    const result = await previewOpenClawBridgeSendForReview({
      channel: 'slack',
      cwd: '/repo',
      messageId: 'msg-1',
      text: 'approved answer',
    });

    expect(sendOpenClawResponse).toHaveBeenCalledWith(
      {
        channel: 'slack',
        dryRun: true,
        endpointPath: undefined,
        messageId: 'msg-1',
        text: 'approved answer',
        threadId: undefined,
      },
      { cwd: '/repo', home: undefined },
    );
    expect(result.result?.dryRun).toBe(true);
  });

  it('refuses live send without an approver', async () => {
    const sendOpenClawResponse = vi.fn();
    mockedLoadCoreModule.mockResolvedValue({ sendOpenClawResponse });

    const result = await sendOpenClawBridgeResponseForReview({
      approvedBy: '',
      channel: 'slack',
      messageId: 'msg-1',
      text: 'approved answer',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/approvedBy is required/);
    expect(sendOpenClawResponse).not.toHaveBeenCalled();
  });

  it('runs live send only with explicit confirmation flags', async () => {
    const sendOpenClawResponse = vi.fn().mockResolvedValue({ dryRun: false, status: 'sent' });
    mockedLoadCoreModule.mockResolvedValue({ sendOpenClawResponse });

    const result = await sendOpenClawBridgeResponseForReview({
      approvedBy: 'Patrice',
      channel: 'slack',
      cwd: '/repo',
      endpointPath: '/api/send',
      messageId: 'msg-1',
      source: '/home/u/.openclaw',
      text: 'approved answer',
      threadId: 't-1',
    });

    expect(sendOpenClawResponse).toHaveBeenCalledWith(
      {
        approvedBy: 'Patrice',
        channel: 'slack',
        dryRun: false,
        endpointPath: '/api/send',
        liveSendConfirmed: true,
        messageId: 'msg-1',
        text: 'approved answer',
        threadId: 't-1',
      },
      { cwd: '/repo', home: '/home/u/.openclaw' },
    );
    expect(result.result?.status).toBe('sent');
  });
});
