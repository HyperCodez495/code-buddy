/**
 * Phase (d).10 V0.4.1 — compaction-bridge tests.
 *
 * Validates that wireCompactionBridge() attaches listeners to the
 * SmartCompactionEngine singleton and re-emits to the fleet broadcast
 * helpers, that wire is idempotent, and that unwire detaches cleanly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

const broadcastStartMock = vi.hoisted(() => vi.fn());
const broadcastCompleteMock = vi.hoisted(() => vi.fn());

// One shared fake engine across the suite — wire/unwire toggles whether
// listeners are attached to it. We need a stable EventEmitter so that
// off() calls in unwire actually find what they registered earlier.
const fakeEngine = vi.hoisted(() => new (require('events').EventEmitter as typeof EventEmitter)());

vi.mock('../../src/server/websocket/fleet-bridge.js', () => ({
  broadcastCompactionStart: broadcastStartMock,
  broadcastCompactionComplete: broadcastCompleteMock,
}));

vi.mock('../../src/context/smart-compaction.js', () => ({
  getSmartCompactionEngine: () => fakeEngine,
}));

import {
  wireCompactionBridge,
  unwireCompactionBridge,
  isCompactionBridgeWired,
  _unwireForTests,
} from '../../src/fleet/compaction-bridge.js';

describe('fleet compaction bridge — Phase (d).10 V0.4.1', () => {
  beforeEach(() => {
    broadcastStartMock.mockReset();
    broadcastCompleteMock.mockReset();
    _unwireForTests();
    fakeEngine.removeAllListeners();
  });

  afterEach(() => {
    _unwireForTests();
    fakeEngine.removeAllListeners();
  });

  it('wire attaches start + complete listeners on the engine singleton', () => {
    expect(fakeEngine.listenerCount('compaction:start')).toBe(0);
    expect(fakeEngine.listenerCount('compaction:complete')).toBe(0);

    wireCompactionBridge();

    expect(isCompactionBridgeWired()).toBe(true);
    expect(fakeEngine.listenerCount('compaction:start')).toBe(1);
    expect(fakeEngine.listenerCount('compaction:complete')).toBe(1);
  });

  it('wire is idempotent (second call leaves the listener count unchanged)', () => {
    wireCompactionBridge();
    wireCompactionBridge();

    expect(fakeEngine.listenerCount('compaction:start')).toBe(1);
    expect(fakeEngine.listenerCount('compaction:complete')).toBe(1);
  });

  it('unwire detaches both listeners', () => {
    wireCompactionBridge();
    expect(fakeEngine.listenerCount('compaction:start')).toBe(1);

    unwireCompactionBridge();

    expect(isCompactionBridgeWired()).toBe(false);
    expect(fakeEngine.listenerCount('compaction:start')).toBe(0);
    expect(fakeEngine.listenerCount('compaction:complete')).toBe(0);
  });

  it('forwards compaction:start payload to broadcastCompactionStart', () => {
    wireCompactionBridge();
    fakeEngine.emit('compaction:start', { messageCount: 42, tokens: 12345 });

    expect(broadcastStartMock).toHaveBeenCalledOnce();
    expect(broadcastStartMock).toHaveBeenCalledWith({
      messageCount: 42,
      tokens: 12345,
    });
  });

  it('forwards compaction:complete payload (incl. result fields) to broadcastCompactionComplete', () => {
    wireCompactionBridge();
    fakeEngine.emit('compaction:complete', {
      success: true,
      originalTokens: 20_000,
      compactedTokens: 8_000,
      messagesRemoved: 12,
      strategy: 'hybrid',
      durationMs: 1234,
    });

    expect(broadcastCompleteMock).toHaveBeenCalledOnce();
    expect(broadcastCompleteMock).toHaveBeenCalledWith({
      success: true,
      originalTokens: 20_000,
      compactedTokens: 8_000,
      messagesRemoved: 12,
      strategy: 'hybrid',
      durationMs: 1234,
    });
  });

  it('survives a broadcast helper throw without detaching the listener', () => {
    broadcastStartMock.mockImplementationOnce(() => {
      throw new Error('ws server not running');
    });
    wireCompactionBridge();

    // Should NOT throw outwards
    expect(() => fakeEngine.emit('compaction:start', { messageCount: 1 })).not.toThrow();

    // Listener still attached for the next emit
    fakeEngine.emit('compaction:start', { messageCount: 2 });
    expect(broadcastStartMock).toHaveBeenCalledTimes(2);
  });

  it('after unwire, engine emits no longer trigger broadcasts', () => {
    wireCompactionBridge();
    unwireCompactionBridge();

    fakeEngine.emit('compaction:start', { messageCount: 99 });
    fakeEngine.emit('compaction:complete', { success: true });

    expect(broadcastStartMock).not.toHaveBeenCalled();
    expect(broadcastCompleteMock).not.toHaveBeenCalled();
  });
});
