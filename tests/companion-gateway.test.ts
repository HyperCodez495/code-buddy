import { mkdtemp, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  formatCompanionGatewayMessageResult,
  formatCompanionGatewayProfile,
  getCompanionGatewayProfilePath,
  readCompanionGatewayProfile,
  recordCompanionGatewayMessage,
  updateCompanionGatewayChannel,
} from '../src/companion/gateway.js';
import { readRecentCompanionPercepts } from '../src/companion/percepts.js';
import { readRecentCompanionSafetyEvents } from '../src/companion/safety-ledger.js';

describe('companion gateway', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'buddy-gateway-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads a disabled default profile for common channels', async () => {
    const profile = await readCompanionGatewayProfile({
      cwd: tempDir,
      now: new Date('2026-05-24T10:00:00.000Z'),
    });

    expect(profile.storePath).toBe(getCompanionGatewayProfilePath(tempDir));
    expect(profile.channels.find(channel => channel.channel === 'telegram')).toMatchObject({
      enabled: false,
      mode: 'observe',
      allowOutbound: false,
      requireApprovalForTools: true,
    });
    expect(formatCompanionGatewayProfile(profile)).toContain('Buddy Companion Gateway Profile');
  });

  it('enables a channel and records inbound messages as percepts plus safety events', async () => {
    await updateCompanionGatewayChannel('telegram', {
      cwd: tempDir,
      enabled: true,
      mode: 'assist',
      allowOutbound: false,
      now: new Date('2026-05-24T10:00:00.000Z'),
    });

    const result = await recordCompanionGatewayMessage({
      channel: 'telegram',
      senderId: 'patrice',
      senderName: 'Patrice',
      threadId: 'dm-1',
      messageId: 'm-1',
      text: 'Buddy, prepare a voice check-in.',
      contentType: 'text',
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T10:01:00.000Z'),
    });

    expect(result.accepted).toBe(true);
    expect(result.sessionKey).toBe('companion:telegram:dm-1');
    expect(result.percept?.source).toBe('companion_gateway:telegram');
    expect(formatCompanionGatewayMessageResult(result)).toContain('message accepted');

    const percepts = await readRecentCompanionPercepts({ cwd: tempDir, modality: 'hearing' });
    expect(percepts[0]).toMatchObject({
      source: 'companion_gateway:telegram',
      tags: expect.arrayContaining(['gateway', 'telegram', 'assist', 'text']),
    });

    const safety = await readRecentCompanionSafetyEvents({ cwd: tempDir, kind: 'data' });
    expect(safety[0]).toMatchObject({
      action: 'companion_gateway_ingest',
      status: 'completed',
      source: 'companion_gateway',
    });
  });

  it('denies disabled channels while still recording an audit event', async () => {
    const result = await recordCompanionGatewayMessage({
      channel: 'discord',
      senderId: 'user-1',
      text: 'hello',
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T10:02:00.000Z'),
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('disabled');
    expect(result.percept).toBeUndefined();

    const percepts = await readRecentCompanionPercepts({ cwd: tempDir });
    expect(percepts).toEqual([]);

    const safety = await readRecentCompanionSafetyEvents({ cwd: tempDir, kind: 'data' });
    expect(safety[0]).toMatchObject({
      action: 'companion_gateway_ingest_denied',
      status: 'denied',
    });
  });
});
