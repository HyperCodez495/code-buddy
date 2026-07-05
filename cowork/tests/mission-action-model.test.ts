import { describe, expect, it } from 'vitest';

import { availableActions, requiresConfirmation } from '../src/renderer/components/os-actions/utils/mission-action-model.js';

describe('mission-action-model', () => {
  it('exposes only safe actions for each mission status', () => {
    expect(availableActions('running')).toEqual(['pause', 'cancel', 'branch']);
    expect(availableActions('paused')).toEqual(['resume', 'cancel', 'branch']);
    expect(availableActions('cancelled')).toEqual([]);
  });

  it('marks destructive or topology-changing actions as confirmed', () => {
    expect(requiresConfirmation('cancel')).toBe(true);
    expect(requiresConfirmation('branch')).toBe(true);
    expect(requiresConfirmation('pause')).toBe(false);
  });
});
