/**
 * Tests for the pure `applyGroundingToggle` helper.
 *
 * The function is intentionally tiny so we can validate the three
 * branches exhaustively without ever touching Electron, the engine
 * adapter implementation, or the IPC layer.
 */

import { describe, expect, it, vi } from 'vitest';
import { applyGroundingToggle, applyVisionGroundingSetting } from '../src/main/codebuddy/grounding-handler';
import type { EngineAdapterLike } from '../src/main/session/session-manager';

function makeAdapter(overrides: Partial<EngineAdapterLike> = {}): EngineAdapterLike {
  return {
    runSession: vi.fn().mockResolvedValue({ content: '' }),
    cancel: vi.fn(),
    clearSession: vi.fn(),
    ...overrides,
  };
}

describe('applyGroundingToggle', () => {
  it('returns ok=false with reason "no-adapter" when adapter is undefined', () => {
    const result = applyGroundingToggle(undefined, true);
    expect(result).toEqual({ ok: false, reason: 'no-adapter' });
  });

  it('returns ok=false with reason "unsupported" when adapter has no setDefaultGoogleSearch', () => {
    // pi-coding-agent fallback or any adapter not routing through Gemini-native.
    const adapter = makeAdapter();
    const result = applyGroundingToggle(adapter, true);
    expect(result).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('forwards the toggle to the adapter and returns ok=true when supported', () => {
    const setDefaultGoogleSearch = vi.fn();
    const adapter = makeAdapter({ setDefaultGoogleSearch });
    const result = applyGroundingToggle(adapter, true);
    expect(result).toEqual({ ok: true });
    expect(setDefaultGoogleSearch).toHaveBeenCalledTimes(1);
    expect(setDefaultGoogleSearch).toHaveBeenCalledWith(true);
  });

  it('forwards `false` to the adapter (disabling grounding mid-flight)', () => {
    const setDefaultGoogleSearch = vi.fn();
    const adapter = makeAdapter({ setDefaultGoogleSearch });
    const result = applyGroundingToggle(adapter, false);
    expect(result).toEqual({ ok: true });
    expect(setDefaultGoogleSearch).toHaveBeenCalledWith(false);
  });

  it('does not throw if the adapter throws synchronously — caller responsibility', () => {
    // Defensive sanity check: today the function lets exceptions
    // propagate (no try/catch). If we ever change that policy, this
    // test reminds us to also update the IPC wrapper accordingly.
    const adapter = makeAdapter({
      setDefaultGoogleSearch: () => {
        throw new Error('boom');
      },
    });
    expect(() => applyGroundingToggle(adapter, true)).toThrowError('boom');
  });
});

describe('applyVisionGroundingSetting', () => {
  it('returns ok=false with reason "no-adapter" when adapter is undefined', () => {
    const result = applyVisionGroundingSetting(undefined, true);
    expect(result).toEqual({ ok: false, reason: 'no-adapter' });
  });

  it('returns ok=false with reason "unsupported" when adapter has no setDefaultVisionGrounding', () => {
    const adapter = makeAdapter();
    const result = applyVisionGroundingSetting(adapter, true);
    expect(result).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('forwards the toggle and model to the adapter and returns ok=true when supported', () => {
    const setDefaultVisionGrounding = vi.fn();
    const adapter = makeAdapter({ setDefaultVisionGrounding });
    const result = applyVisionGroundingSetting(adapter, true, 'gemini-2.5-flash');
    expect(result).toEqual({ ok: true });
    expect(setDefaultVisionGrounding).toHaveBeenCalledTimes(1);
    expect(setDefaultVisionGrounding).toHaveBeenCalledWith(true, 'gemini-2.5-flash');
  });

  it('forwards `false` to the adapter (disabling vision grounding)', () => {
    const setDefaultVisionGrounding = vi.fn();
    const adapter = makeAdapter({ setDefaultVisionGrounding });
    const result = applyVisionGroundingSetting(adapter, false);
    expect(result).toEqual({ ok: true });
    expect(setDefaultVisionGrounding).toHaveBeenCalledWith(false, undefined);
  });
});

