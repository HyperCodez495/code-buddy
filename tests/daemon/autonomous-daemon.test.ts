import { describe, it, expect, vi } from 'vitest';
import { FleetAutonomousDaemon } from '../../src/daemon/autonomous-daemon';
import type { FleetAutonomousLoop, TickResult } from '../../src/daemon/autonomous-loop';

function fakeLoop(outcomes: TickResult['outcome'][]): { loop: FleetAutonomousLoop; ticks: () => number } {
  let i = 0;
  const loop = {
    tick: vi.fn(async (): Promise<TickResult> => {
      const outcome = outcomes[Math.min(i, outcomes.length - 1)] ?? 'idle';
      i += 1;
      return { outcome };
    }),
  } as unknown as FleetAutonomousLoop;
  return { loop, ticks: () => i };
}

describe('FleetAutonomousDaemon', () => {
  it('runs a bounded number of ticks and sleeps between them', async () => {
    const { loop } = fakeLoop(['completed', 'completed', 'idle']);
    const sleep = vi.fn(async () => {});
    const seen: number[] = [];
    const daemon = new FleetAutonomousDaemon({
      loop, intervalMs: 5, sleep, onTick: (_r, n) => seen.push(n),
    });

    const summary = await daemon.run({ maxTicks: 3 });

    expect(summary.ticks).toBe(3);
    expect(summary.stoppedReason).toBe('maxTicks');
    expect(summary.outcomes).toEqual({ completed: 2, idle: 1 });
    expect(seen).toEqual([1, 2, 3]);
    // sleeps between ticks only: maxTicks - 1
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(daemon.isRunning()).toBe(false);
  });

  it('stops cleanly when stop() is called from a tick callback', async () => {
    const { loop } = fakeLoop(['idle']);
    const daemon = new FleetAutonomousDaemon({
      loop, sleep: async () => {},
      onTick: (_r, n) => { if (n === 2) daemon.stop(); },
    });
    const summary = await daemon.run({ maxTicks: 100 });
    expect(summary.ticks).toBe(2);
    expect(summary.stoppedReason).toBe('stopped');
  });

  it('wake() cuts the interval short for immediate, message-queue-style ticks', async () => {
    const { loop } = fakeLoop(['idle', 'idle']);
    // Long interval so the second tick would never arrive in time without wake().
    const daemon = new FleetAutonomousDaemon({ loop, intervalMs: 100_000 });
    const run = daemon.run({ maxTicks: 2 });
    // First tick fires immediately; daemon is now waiting ~100s. Wake it.
    await new Promise((r) => setTimeout(r, 15));
    daemon.wake();
    const summary = await run;
    expect(summary.ticks).toBe(2);
    expect(summary.stoppedReason).toBe('maxTicks');
  });

  it('ticks on an external event (eventSourceFactory) and stops the source on exit', async () => {
    const { loop } = fakeLoop(['idle', 'idle']);
    let capturedWake: (() => void) | undefined;
    const stop = vi.fn();
    const eventSourceFactory = vi.fn((wake: () => void) => { capturedWake = wake; return { stop }; });
    // Long interval so polling cannot explain the second tick (no injected sleep
    // → real interruptible wait, which wake() cuts short).
    const daemon = new FleetAutonomousDaemon({ loop, intervalMs: 100_000, eventSourceFactory });
    const run = daemon.run({ maxTicks: 2 });
    // First tick fires immediately; daemon now waiting ~100s. Fire an external event.
    await new Promise((r) => setTimeout(r, 15));
    capturedWake?.();
    const summary = await run;

    expect(summary.ticks).toBe(2);
    expect(eventSourceFactory).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1); // cleaned up on exit
  });

  it('does not tick when the kill-switch is off', async () => {
    const { loop, ticks } = fakeLoop(['idle']);
    const daemon = new FleetAutonomousDaemon({ loop, enabled: () => false, sleep: async () => {} });
    const summary = await daemon.run({ maxTicks: 5 });
    expect(summary.ticks).toBe(0);
    expect(summary.stoppedReason).toBe('disabled');
    expect(ticks()).toBe(0);
  });
});
