/**
 * Phase (d).2 V0.4.1 — emitFleetToolStarted / emitFleetToolCompleted unit tests.
 *
 * Validates the env-gated opt-in, payload shape, and best-effort error handling.
 * The fleet-bridge module is mocked so tests don't need a live WS server.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const broadcastFleetEventMock = vi.fn();

import {
  emitFleetToolStarted,
  emitFleetToolCompleted,
  registerFleetBroadcaster,
} from '../../../src/agent/execution/tool-hooks.js';

// Wire the mock manually since we broke the hardcoded dependency
registerFleetBroadcaster(broadcastFleetEventMock);

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

describe('fleet tool hooks — Phase (d).2 V0.4.1', () => {
  beforeEach(() => {
    broadcastFleetEventMock.mockReset();
    delete process.env.CODEBUDDY_FLEET_STREAM;
  });

  afterEach(() => {
    delete process.env.CODEBUDDY_FLEET_STREAM;
  });

  describe('emitFleetToolStarted', () => {
    it('no-op when CODEBUDDY_FLEET_STREAM is unset (default)', async () => {
      emitFleetToolStarted({ id: 't1', function: { name: 'view_file' } });
      // No flush needed — emits are now synchronous (eager import in source).
      expect(broadcastFleetEventMock).not.toHaveBeenCalled();
    });

    it('fires when CODEBUDDY_FLEET_STREAM=1', async () => {
      process.env.CODEBUDDY_FLEET_STREAM = '1';
      emitFleetToolStarted({ id: 't1', function: { name: 'view_file' } });
      // No flush needed — emits are now synchronous (eager import in source).
      expect(broadcastFleetEventMock).toHaveBeenCalledOnce();
      const [type, payload] = broadcastFleetEventMock.mock.calls[0];
      expect(type).toBe('fleet:agent:tool_started');
      expect(payload).toMatchObject({ toolName: 'view_file', toolCallId: 't1' });
    });

    it('also accepts CODEBUDDY_FLEET_STREAM=true', async () => {
      process.env.CODEBUDDY_FLEET_STREAM = 'true';
      emitFleetToolStarted({ id: 't2', function: { name: 'edit_file' } });
      // No flush needed — emits are now synchronous (eager import in source).
      expect(broadcastFleetEventMock).toHaveBeenCalledOnce();
    });

    it('does NOT fire on CODEBUDDY_FLEET_STREAM=0', async () => {
      process.env.CODEBUDDY_FLEET_STREAM = '0';
      emitFleetToolStarted({ id: 't3', function: { name: 'bash' } });
      // No flush needed — emits are now synchronous (eager import in source).
      expect(broadcastFleetEventMock).not.toHaveBeenCalled();
    });

    it('does NOT fire on CODEBUDDY_FLEET_STREAM=false', async () => {
      process.env.CODEBUDDY_FLEET_STREAM = 'false';
      emitFleetToolStarted({ id: 't4', function: { name: 'bash' } });
      // No flush needed — emits are now synchronous (eager import in source).
      expect(broadcastFleetEventMock).not.toHaveBeenCalled();
    });

    it('swallows broadcast errors (best-effort, never throws)', async () => {
      process.env.CODEBUDDY_FLEET_STREAM = '1';
      broadcastFleetEventMock.mockImplementationOnce(() => {
        throw new Error('WS server not running');
      });
      // The throw is inside the lazy-imported promise's .then() — should
      // still not surface to the caller.
      expect(() =>
        emitFleetToolStarted({ id: 't5', function: { name: 'x' } }),
      ).not.toThrow();
      // No flush needed — emits are now synchronous (eager import in source).
    });
  });

  describe('emitFleetToolCompleted', () => {
    it('no-op when CODEBUDDY_FLEET_STREAM is unset', async () => {
      emitFleetToolCompleted(
        { id: 't1', function: { name: 'view_file' } },
        { success: true },
        100,
      );
      // No flush needed — emits are now synchronous (eager import in source).
      expect(broadcastFleetEventMock).not.toHaveBeenCalled();
    });

    it('emits fleet:agent:tool_completed on success', async () => {
      process.env.CODEBUDDY_FLEET_STREAM = '1';
      emitFleetToolCompleted(
        { id: 't1', function: { name: 'view_file' } },
        { success: true },
        250,
      );
      // No flush needed — emits are now synchronous (eager import in source).
      expect(broadcastFleetEventMock).toHaveBeenCalledOnce();
      const [type, payload] = broadcastFleetEventMock.mock.calls[0];
      expect(type).toBe('fleet:agent:tool_completed');
      expect(payload).toMatchObject({
        toolName: 'view_file',
        toolCallId: 't1',
        success: true,
        durationMs: 250,
      });
    });

    it('emits fleet:agent:tool_error on failure', async () => {
      process.env.CODEBUDDY_FLEET_STREAM = '1';
      emitFleetToolCompleted(
        { id: 't2', function: { name: 'bash' } },
        { success: false, error: 'exit code 1' },
        500,
      );
      // No flush needed — emits are now synchronous (eager import in source).
      expect(broadcastFleetEventMock).toHaveBeenCalledOnce();
      const [type, payload] = broadcastFleetEventMock.mock.calls[0];
      expect(type).toBe('fleet:agent:tool_error');
      expect(payload).toMatchObject({
        toolName: 'bash',
        toolCallId: 't2',
        success: false,
        durationMs: 500,
        error: 'exit code 1',
      });
    });

    it('passes durationMs through verbatim', async () => {
      process.env.CODEBUDDY_FLEET_STREAM = '1';
      emitFleetToolCompleted(
        { id: 't3', function: { name: 'x' } },
        { success: true },
        12345,
      );
      // No flush needed — emits are now synchronous (eager import in source).
      const payload = broadcastFleetEventMock.mock.calls[0][1] as { durationMs: number };
      expect(payload.durationMs).toBe(12345);
    });

    it('swallows broadcast errors on completed (best-effort)', async () => {
      process.env.CODEBUDDY_FLEET_STREAM = '1';
      broadcastFleetEventMock.mockImplementationOnce(() => {
        throw new Error('boom');
      });
      expect(() =>
        emitFleetToolCompleted(
          { id: 't', function: { name: 'x' } },
          { success: true },
          1,
        ),
      ).not.toThrow();
      // No flush needed — emits are now synchronous (eager import in source).
    });
  });
});
