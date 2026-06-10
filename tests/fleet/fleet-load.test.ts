/**
 * Fleet live-load tracker — the measurement behind the router's load
 * term, the heartbeat load payload, and the daemon's saturation
 * backpressure. Counters, idempotent done(), capacity parsing, and the
 * saturation predicate.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  beginFleetWork,
  getFleetLoad,
  isFleetSaturated,
  resolveFleetMaxConcurrency,
  _resetFleetLoadForTests,
} from '../../src/fleet/fleet-load';

describe('fleet-load tracker', () => {
  beforeEach(() => {
    _resetFleetLoadForTests();
  });

  afterEach(() => {
    _resetFleetLoadForTests();
  });

  it('counts in-flight work per kind and in total', () => {
    const doneA = beginFleetWork('peer.dispatch');
    const doneB = beginFleetWork('peer.dispatch');
    const doneC = beginFleetWork('autonomy.task');

    const load = getFleetLoad({});
    expect(load.activeRequests).toBe(3);
    expect(load.byKind['peer.dispatch']).toBe(2);
    expect(load.byKind['autonomy.task']).toBe(1);
    expect(load.peakActiveRequests).toBe(3);

    doneA();
    doneB();
    doneC();
    const after = getFleetLoad({});
    expect(after.activeRequests).toBe(0);
    expect(after.byKind).toEqual({});
    expect(after.completedCount).toBe(3);
    // Peak is sticky — diagnostic of the busiest moment.
    expect(after.peakActiveRequests).toBe(3);
  });

  it('done() is idempotent — double-calling never goes negative', () => {
    const done = beginFleetWork('peer.chat');
    done();
    done();
    done();

    const load = getFleetLoad({});
    expect(load.activeRequests).toBe(0);
    expect(load.completedCount).toBe(1);
  });

  it('parses capacity from CODEBUDDY_FLEET_MAX_CONCURRENCY, rejecting junk', () => {
    expect(resolveFleetMaxConcurrency({ CODEBUDDY_FLEET_MAX_CONCURRENCY: '4' })).toBe(4);
    expect(resolveFleetMaxConcurrency({ CODEBUDDY_FLEET_MAX_CONCURRENCY: '0' })).toBeUndefined();
    expect(resolveFleetMaxConcurrency({ CODEBUDDY_FLEET_MAX_CONCURRENCY: '-2' })).toBeUndefined();
    expect(resolveFleetMaxConcurrency({ CODEBUDDY_FLEET_MAX_CONCURRENCY: 'lots' })).toBeUndefined();
    expect(resolveFleetMaxConcurrency({})).toBeUndefined();
  });

  it('reports utilization against the configured capacity, null when unknown', () => {
    const done = beginFleetWork('peer.chat-session');

    expect(getFleetLoad({}).utilization).toBeNull();
    const withCap = getFleetLoad({ CODEBUDDY_FLEET_MAX_CONCURRENCY: '2' });
    expect(withCap.maxConcurrency).toBe(2);
    expect(withCap.utilization).toBe(0.5);

    done();
  });

  it('saturation is opt-in: never true without a configured capacity', () => {
    beginFleetWork('peer.dispatch');
    beginFleetWork('peer.dispatch');

    expect(isFleetSaturated({})).toBe(false);
    expect(isFleetSaturated({ CODEBUDDY_FLEET_MAX_CONCURRENCY: '2' })).toBe(true);
    expect(isFleetSaturated({ CODEBUDDY_FLEET_MAX_CONCURRENCY: '3' })).toBe(false);
  });
});
