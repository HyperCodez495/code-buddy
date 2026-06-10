/**
 * WS3-T3 — SessionDurationMiddleware: suggest a clean pause (with a fresh
 * snapshot resume point) once a session runs past the threshold, reminding
 * on a cadence instead of nagging every turn. Never stops the loop.
 */

import { SessionDurationMiddleware } from '../../../src/agent/middleware/session-duration.js';
import type { MiddlewareContext } from '../../../src/agent/middleware/types.js';

const HOUR = 3_600_000;

function ctx(): MiddlewareContext {
  return {
    toolRound: 0,
    maxToolRounds: 50,
    sessionCost: 0,
    sessionCostLimit: 10,
    inputTokens: 0,
    outputTokens: 0,
    history: [],
    messages: [],
    isStreaming: false,
  };
}

function makeClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => { now += ms; },
  };
}

describe('SessionDurationMiddleware (WS3-T3)', () => {
  it('stays silent below the threshold', () => {
    const clock = makeClock();
    const mw = new SessionDurationMiddleware({ maxSessionMs: 12 * HOUR, now: clock.now });

    clock.advance(11 * HOUR);
    expect(mw.beforeTurn(ctx()).action).toBe('continue');
  });

  it('warns (never stops) past the threshold and takes a snapshot', () => {
    const clock = makeClock();
    const takeSnapshot = vi.fn();
    const mw = new SessionDurationMiddleware({
      maxSessionMs: 12 * HOUR,
      now: clock.now,
      takeSnapshot,
    });

    clock.advance(12.5 * HOUR);
    const result = mw.beforeTurn(ctx());

    expect(result.action).toBe('warn');
    expect(result.message).toContain('12.5 h');
    expect(result.message).toContain('buddy --continue');
    expect(takeSnapshot).toHaveBeenCalledTimes(1);
  });

  it('reminds on the cadence instead of nagging every turn', () => {
    const clock = makeClock();
    const mw = new SessionDurationMiddleware({
      maxSessionMs: 12 * HOUR,
      remindEveryMs: HOUR,
      now: clock.now,
    });

    clock.advance(12 * HOUR);
    expect(mw.beforeTurn(ctx()).action).toBe('warn');
    // Next turns within the hour stay silent…
    clock.advance(10 * 60_000);
    expect(mw.beforeTurn(ctx()).action).toBe('continue');
    clock.advance(30 * 60_000);
    expect(mw.beforeTurn(ctx()).action).toBe('continue');
    // …and the reminder fires after the cadence.
    clock.advance(21 * 60_000);
    expect(mw.beforeTurn(ctx()).action).toBe('warn');
  });

  it('is disabled with a 0 threshold (CODEBUDDY_SESSION_PAUSE_HOURS=0)', () => {
    const clock = makeClock();
    const mw = new SessionDurationMiddleware({ maxSessionMs: 0, now: clock.now });

    clock.advance(100 * HOUR);
    expect(mw.beforeTurn(ctx()).action).toBe('continue');
  });

  it('survives a throwing snapshot hook', () => {
    const clock = makeClock();
    const mw = new SessionDurationMiddleware({
      maxSessionMs: HOUR,
      now: clock.now,
      takeSnapshot: () => { throw new Error('disk full'); },
    });

    clock.advance(2 * HOUR);
    expect(mw.beforeTurn(ctx()).action).toBe('warn');
  });
});
