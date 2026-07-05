import { describe, expect, it } from 'vitest';

import { pickLatestStable, type Checkpoint } from '../src/renderer/utils/checkpoint-model';

describe('pickLatestStable', () => {
  it('returns the newest stable checkpoint', () => {
    const checkpoints: Checkpoint[] = [
      { id: 'a', label: 'First stable', createdAt: 100, status: 'stable' },
      { id: 'b', label: 'Draft', createdAt: 300, status: 'draft' },
      { id: 'c', label: 'Latest stable', createdAt: 200, status: 'stable' },
    ];

    expect(pickLatestStable(checkpoints)?.id).toBe('c');
  });

  it('ignores failed checkpoints', () => {
    const checkpoints: Checkpoint[] = [
      { id: 'a', label: 'Failed', createdAt: 900, status: 'failed' },
      { id: 'b', label: 'Stable', createdAt: 100, status: 'stable' },
    ];

    expect(pickLatestStable(checkpoints)?.id).toBe('b');
  });

  it('returns null when no checkpoint is stable', () => {
    expect(pickLatestStable([{ id: 'a', label: 'Draft', createdAt: 1, status: 'draft' }])).toBeNull();
  });
});
