import { describe, expect, it } from 'vitest';

// NO mocks: exercise the real core chain
//   executeHeadlessSlashToken -> getEnhancedCommandHandler -> real handler.
// This is the one test that proves info commands actually produce headless
// output, rather than asserting it against a fake of the next layer.
import { executeHeadlessSlashToken } from '../../src/commands/headless-slash.js';

const ALLOW = new Set(['__HELP__', '__STATS__']);

describe('headless slash — real engine chain (no mocks)', () => {
  it('runs __HELP__ end-to-end and returns real, non-empty help output', async () => {
    const res = await executeHeadlessSlashToken('__HELP__', [], ALLOW);
    expect(res.handled).toBe(true);
    expect(res.denied).toBeUndefined();
    expect(typeof res.output).toBe('string');
    expect((res.output ?? '').length).toBeGreaterThan(0);
  });

  it('runs __STATS__ against the real singleton and returns string output', async () => {
    const res = await executeHeadlessSlashToken('__STATS__', [], ALLOW);
    expect(res.handled).toBe(true);
    expect(typeof res.output).toBe('string');
  });

  it('default-denies a token outside the allow set on the real path (no execution)', async () => {
    const res = await executeHeadlessSlashToken('__YOLO_MODE__', ['on'], ALLOW);
    expect(res).toMatchObject({ handled: true, denied: true });
  });
});
