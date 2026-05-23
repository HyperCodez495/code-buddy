import { buildCronJobSpec } from '../../src/commands/cron-cli/index.js';

describe('buildCronJobSpec', () => {
  it('requires a name', () => {
    const r = buildCronJobSpec('', { every: '1000', message: 'hi' });
    expect('error' in r && r.error).toMatch(/name is required/);
  });

  it('requires exactly one schedule flag', () => {
    expect('error' in buildCronJobSpec('j', { message: 'hi' })).toBe(true);
    const both = buildCronJobSpec('j', { every: '1000', cron: '* * * * *', message: 'hi' });
    expect('error' in both && both.error).toMatch(/mutually exclusive/);
  });

  it('builds an every-message job', () => {
    const r = buildCronJobSpec('Lead refresh', { every: '3600000', message: 'run discovery' });
    expect('spec' in r).toBe(true);
    if ('spec' in r) {
      expect(r.spec.type).toBe('every');
      expect(r.spec.schedule.every).toBe(3600000);
      expect(r.spec.task).toEqual({ type: 'message', message: 'run discovery' });
    }
  });

  it('rejects a non-positive --every', () => {
    const r = buildCronJobSpec('j', { every: '0', message: 'hi' });
    expect('error' in r && r.error).toMatch(/positive number/);
  });

  it('validates a 5-field cron expression', () => {
    expect('error' in buildCronJobSpec('j', { cron: '* * *', message: 'hi' })).toBe(true);
    const r = buildCronJobSpec('Nightly', { cron: '0 2 * * *', message: 'audit' });
    expect('spec' in r && r.spec.type).toBe('cron');
  });

  it('normalizes --at to ISO and rejects invalid timestamps', () => {
    expect('error' in buildCronJobSpec('j', { at: 'not-a-date', message: 'hi' })).toBe(true);
    const r = buildCronJobSpec('Once', { at: '2030-01-01T00:00:00Z', message: 'hi' });
    expect('spec' in r && r.spec.type).toBe('at');
    if ('spec' in r) expect(r.spec.schedule.at).toBe('2030-01-01T00:00:00.000Z');
  });

  it('requires --message unless --watchdog is given', () => {
    const r = buildCronJobSpec('j', { every: '1000' });
    expect('error' in r && r.error).toMatch(/--message is required/);
  });

  it('builds a watchdog job from inline JSON', () => {
    const r = buildCronJobSpec('Disk check', {
      cron: '0 * * * *',
      watchdog: JSON.stringify({ checks: [{ type: 'disk', minFreeBytes: 1000 }] }),
    });
    expect('spec' in r).toBe(true);
    if ('spec' in r) {
      expect(r.spec.task.type).toBe('watchdog');
      expect(r.spec.task.watchdog?.checks).toHaveLength(1);
    }
  });

  it('rejects a watchdog config without checks', () => {
    const r = buildCronJobSpec('j', { every: '1000', watchdog: JSON.stringify({ checks: [] }) });
    expect('error' in r && r.error).toMatch(/non-empty "checks"/);
  });

  it('rejects invalid JSON for --watchdog', () => {
    const r = buildCronJobSpec('j', { every: '1000', watchdog: '{not json}' });
    expect('error' in r && r.error).toMatch(/invalid JSON/);
  });

  it('attaches a pre-check gate', () => {
    const r = buildCronJobSpec('Guarded', {
      every: '1000',
      message: 'work',
      preCheck: JSON.stringify({ type: 'file_changed', paths: ['seed.csv'] }),
    });
    expect('spec' in r).toBe(true);
    if ('spec' in r) expect(r.spec.preCheck?.type).toBe('file_changed');
  });

  it('rejects a pre-check with an invalid type', () => {
    const r = buildCronJobSpec('j', {
      every: '1000',
      message: 'work',
      preCheck: JSON.stringify({ type: 'nonsense' }),
    });
    expect('error' in r && r.error).toMatch(/file_changed.*command/);
  });

  it('attaches delivery targets and a summary format', () => {
    const r = buildCronJobSpec('Reporter', {
      cron: '0 9 * * *',
      message: 'daily report',
      deliver: ['telegram:1', 'discord:2'],
      format: 'summary',
    });
    expect('spec' in r).toBe(true);
    if ('spec' in r) {
      expect(r.spec.delivery?.targets).toEqual(['telegram:1', 'discord:2']);
      expect(r.spec.delivery?.format).toBe('summary');
    }
  });

  it('rejects an invalid delivery format', () => {
    const r = buildCronJobSpec('j', { every: '1000', message: 'hi', format: 'weird' });
    expect('error' in r && r.error).toMatch(/full.*summary/);
  });
});
