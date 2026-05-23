/**
 * Multi-channel scheduled delivery fan-out (item 16) + mobile-safe summary.
 */

import { CronAgentBridge, resetCronAgentBridge } from '../../src/daemon/cron-agent-bridge.js';
import type { CronJob } from '../../src/scheduler/cron-scheduler.js';

const sendMock = vi.fn();

vi.mock('../../src/channels/index.js', () => ({
  getChannelManager: () => ({ send: sendMock }),
}));

// The lifecycle hook reads the workspace; stub it to always allow delivery.
vi.mock('../../src/hooks/hermes-lifecycle-hooks.js', () => ({
  executeHermesLifecycleHook: vi.fn(async () => ({ allowed: true })),
}));

function deliveryJob(delivery: CronJob['delivery']): CronJob {
  return {
    id: 'delivery-job',
    name: 'Delivery Job',
    type: 'every',
    schedule: { every: 60000 },
    task: { type: 'message', message: 'work' },
    delivery,
    status: 'active',
    createdAt: new Date(),
    runCount: 0,
    errorCount: 0,
    enabled: true,
  };
}

describe('CronAgentBridge multi-channel delivery', () => {
  let bridge: CronAgentBridge;

  beforeEach(() => {
    resetCronAgentBridge();
    sendMock.mockReset();
    sendMock.mockResolvedValue(undefined);
    bridge = new CronAgentBridge({
      apiKey: 'k',
      baseURL: 'http://localhost:3000',
      model: 'm',
      maxToolRounds: 5,
      jobTimeoutMs: 10000,
    });
  });

  it('fans out to multiple channel targets', async () => {
    const job = deliveryJob({ targets: ['telegram:1', 'discord:2', 'slack:3'] });
    const result = await bridge.deliverResult(job, 'hello');

    expect(result.delivered).toBe(true);
    expect(result.channels).toEqual(['telegram:1', 'discord:2', 'slack:3']);
    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(sendMock).toHaveBeenCalledWith('telegram', expect.objectContaining({ channelId: '1' }));
    expect(sendMock).toHaveBeenCalledWith('discord', expect.objectContaining({ channelId: '2' }));
  });

  it('still delivers to the surviving targets when one channel fails', async () => {
    sendMock.mockImplementation((type: string) => {
      if (type === 'discord') return Promise.reject(new Error('discord down'));
      return Promise.resolve(undefined);
    });
    const job = deliveryJob({ targets: ['telegram:1', 'discord:2'] });
    const result = await bridge.deliverResult(job, 'hello');

    expect(result.delivered).toBe(true);
    expect(result.channels).toEqual(['telegram:1']);
  });

  it('merges legacy single channel with targets and de-duplicates', async () => {
    const job = deliveryJob({ channel: 'telegram:1', targets: ['telegram:1', 'email:ops@x.com'] });
    const result = await bridge.deliverResult(job, 'hello');

    expect(result.channels).toEqual(['telegram:1', 'email:ops@x.com']);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('sends the full body by default and a redacted summary in summary mode', async () => {
    const fullJob = deliveryJob({ channel: 'telegram:1' });
    await bridge.deliverResult(fullJob, 'plain output', 'completed');
    expect(sendMock.mock.calls[0]?.[1].content).toBe('**Cron Job: Delivery Job**\n\nplain output');

    sendMock.mockReset();
    sendMock.mockResolvedValue(undefined);

    const summaryJob = deliveryJob({ channel: 'telegram:1', format: 'summary' });
    await bridge.deliverResult(summaryJob, 'token sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890', 'ok');
    const summaryContent = sendMock.mock.calls[0]?.[1].content as string;
    expect(summaryContent).toContain('Scheduled: Delivery Job');
    expect(summaryContent).toContain('Status: ok');
    expect(summaryContent).not.toContain('sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890');
  });

  it('reports not delivered when there are no channel targets', async () => {
    const job = deliveryJob({ format: 'summary' });
    const result = await bridge.deliverResult(job, 'hello');
    expect(result.delivered).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
