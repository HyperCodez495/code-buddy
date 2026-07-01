/**
 * New-shell view model (opt-in redesign, cowork/REDESIGN.md) — store primitives.
 * The component layer is a thin shell over these, so the store test is the regression net.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../src/renderer/store';

describe('new shell — store view model', () => {
  beforeEach(() => {
    useAppStore.setState({ primaryView: 'chat', newShellEnabled: false });
  });

  it('defaults primaryView to chat (the home surface)', () => {
    expect(useAppStore.getState().primaryView).toBe('chat');
  });

  it('setPrimaryView switches the single primary area', () => {
    useAppStore.getState().setPrimaryView('activity');
    expect(useAppStore.getState().primaryView).toBe('activity');
    useAppStore.getState().setPrimaryView('advanced');
    expect(useAppStore.getState().primaryView).toBe('advanced');
  });

  it('setNewShellEnabled toggles the flag and never throws (localStorage optional)', () => {
    expect(() => useAppStore.getState().setNewShellEnabled(true)).not.toThrow();
    expect(useAppStore.getState().newShellEnabled).toBe(true);
    useAppStore.getState().setNewShellEnabled(false);
    expect(useAppStore.getState().newShellEnabled).toBe(false);
  });
});
