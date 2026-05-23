import {
  collectDeliveryTargets,
  formatScheduledSummary,
  resolveDeliveryBody,
} from '../../src/scheduler/scheduled-delivery.js';

describe('collectDeliveryTargets', () => {
  it('returns empty for no delivery config', () => {
    expect(collectDeliveryTargets(undefined)).toEqual([]);
    expect(collectDeliveryTargets({})).toEqual([]);
  });

  it('parses a single channel spec with type:id', () => {
    expect(collectDeliveryTargets({ channel: 'telegram:chat-123' })).toEqual([
      { spec: 'telegram:chat-123', channelType: 'telegram', channelId: 'chat-123' },
    ]);
  });

  it('defaults channelId to "default" when omitted', () => {
    expect(collectDeliveryTargets({ channel: 'discord' })).toEqual([
      { spec: 'discord', channelType: 'discord', channelId: 'default' },
    ]);
  });

  it('merges single channel and targets, de-duplicating', () => {
    const result = collectDeliveryTargets({
      channel: 'telegram:1',
      targets: ['telegram:1', 'discord:2', 'slack:3'],
    });
    expect(result.map((t) => t.spec)).toEqual(['telegram:1', 'discord:2', 'slack:3']);
  });

  it('ignores blank target entries', () => {
    const result = collectDeliveryTargets({ targets: ['', '  ', 'email:ops@example.com'] });
    expect(result).toEqual([
      { spec: 'email:ops@example.com', channelType: 'email', channelId: 'ops@example.com' },
    ]);
  });
});

describe('formatScheduledSummary', () => {
  it('includes a header with job name and status', () => {
    const result = formatScheduledSummary({
      jobName: 'Nightly audit',
      status: 'ok',
      output: 'All systems nominal.',
    });
    expect(result.content).toContain('Scheduled: Nightly audit');
    expect(result.content).toContain('Status: ok');
    expect(result.content).toContain('All systems nominal.');
    expect(result.truncated).toBe(false);
  });

  it('truncates long output', () => {
    const result = formatScheduledSummary({
      jobName: 'Verbose job',
      status: 'completed',
      output: 'x'.repeat(5000),
      maxChars: 200,
    });
    expect(result.truncated).toBe(true);
    expect(result.content).toContain('[truncated]');
    // Header + capped body, well under the raw 5000 chars.
    expect(result.content.length).toBeLessThan(400);
  });

  it('redacts secrets in the body', () => {
    const result = formatScheduledSummary({
      jobName: 'Leaky job',
      status: 'ok',
      output: 'token sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 done',
    });
    expect(result.content).not.toContain('sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890');
    expect(result.redactionCount).toBeGreaterThanOrEqual(0);
  });

  it('surfaces an optional risk label', () => {
    const result = formatScheduledSummary({
      jobName: 'Risky job',
      status: 'alert',
      output: 'check failed',
      risk: 'high',
    });
    expect(result.content).toContain('Risk: high');
  });
});

describe('resolveDeliveryBody', () => {
  it('produces the legacy full body by default', () => {
    const result = resolveDeliveryBody({
      jobName: 'Job A',
      output: 'full output here',
      status: 'completed',
      format: undefined,
    });
    expect(result.content).toBe('**Cron Job: Job A**\n\nfull output here');
    expect(result.redactionCount).toBe(0);
  });

  it('produces a mobile-safe summary when format is summary', () => {
    const result = resolveDeliveryBody({
      jobName: 'Job B',
      output: 'some output',
      status: 'ok',
      format: 'summary',
    });
    expect(result.content).toContain('Scheduled: Job B');
    expect(result.content).toContain('Status: ok');
  });
});
