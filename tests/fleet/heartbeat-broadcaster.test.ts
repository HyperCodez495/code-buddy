/**
 * Phase (d).9 V0.4.1 — heartbeat-broadcaster module tests.
 *
 * Validates that the singleton timer fires periodically, that start()
 * is idempotent, that stop() cancels cleanly, and that the default
 * interval doesn't fire under fake timer advance below the threshold.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const broadcastMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/server/websocket/fleet-bridge.js', () => ({
  broadcastFleetHeartbeat: broadcastMock,
}));

import {
  startFleetHeartbeat,
  stopFleetHeartbeat,
  isFleetHeartbeatActive,
  getFleetHeartbeatIntervalMs,
  _stopHeartbeatForTests,
} from '../../src/fleet/heartbeat-broadcaster.js';

describe('fleet heartbeat broadcaster — Phase (d).9 V0.4.1', () => {
  beforeEach(() => {
    broadcastMock.mockReset();
    _stopHeartbeatForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    _stopHeartbeatForTests();
    vi.useRealTimers();
  });

  it('fires broadcastFleetHeartbeat on every interval tick', () => {
    startFleetHeartbeat(100);
    expect(isFleetHeartbeatActive()).toBe(true);
    expect(getFleetHeartbeatIntervalMs()).toBe(100);

    vi.advanceTimersByTime(250);
    // Two full intervals @100ms = 2 fires (vi.advanceTimersByTime is
    // strict about timer boundaries; 100ms and 200ms tick).
    expect(broadcastMock).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(200);
    expect(broadcastMock).toHaveBeenCalledTimes(4);
  });

  it('start() twice is idempotent (single timer running)', () => {
    startFleetHeartbeat(100);
    startFleetHeartbeat(50); // requested 50ms but should be ignored
    expect(getFleetHeartbeatIntervalMs()).toBe(100);

    vi.advanceTimersByTime(150);
    expect(broadcastMock).toHaveBeenCalledTimes(1); // not 3 (would be 50+50+50)
  });

  it('stop() cancels the timer; subsequent ticks no longer fire', () => {
    startFleetHeartbeat(100);
    vi.advanceTimersByTime(150);
    expect(broadcastMock).toHaveBeenCalledTimes(1);

    stopFleetHeartbeat();
    expect(isFleetHeartbeatActive()).toBe(false);
    expect(getFleetHeartbeatIntervalMs()).toBe(null);

    vi.advanceTimersByTime(500);
    expect(broadcastMock).toHaveBeenCalledTimes(1); // unchanged
  });

  it('default interval (30s) does not fire under brief advance', () => {
    startFleetHeartbeat(); // default = 30_000
    expect(getFleetHeartbeatIntervalMs()).toBe(30_000);

    vi.advanceTimersByTime(5_000);
    expect(broadcastMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);
    expect(broadcastMock).toHaveBeenCalledTimes(1);
  });

  it('survives a broadcast helper throw without crashing the timer', () => {
    broadcastMock.mockImplementationOnce(() => {
      throw new Error('underlying broadcast failed');
    });
    startFleetHeartbeat(100);

    vi.advanceTimersByTime(100);
    expect(broadcastMock).toHaveBeenCalledTimes(1); // first fired + threw

    vi.advanceTimersByTime(100);
    expect(broadcastMock).toHaveBeenCalledTimes(2); // timer survived
    expect(isFleetHeartbeatActive()).toBe(true);
  });

  it('falls back to default when given a non-positive interval', () => {
    startFleetHeartbeat(0);
    expect(getFleetHeartbeatIntervalMs()).toBe(30_000);
    stopFleetHeartbeat();

    startFleetHeartbeat(-1);
    expect(getFleetHeartbeatIntervalMs()).toBe(30_000);
    stopFleetHeartbeat();

    startFleetHeartbeat(NaN);
    expect(getFleetHeartbeatIntervalMs()).toBe(30_000);
  });
});
