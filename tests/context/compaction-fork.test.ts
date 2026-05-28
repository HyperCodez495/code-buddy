import { describe, expect, it, vi } from 'vitest';
import { recordCompactionFork } from '../../src/context/compaction-fork.js';

describe('recordCompactionFork', () => {
  it('forks the active run and returns the new id', () => {
    const forkRun = vi.fn(() => 'fork-1');
    const id = recordCompactionFork({ forkRun }, 'run-0', 'compaction');
    expect(id).toBe('fork-1');
    expect(forkRun).toHaveBeenCalledWith('run-0', 'compaction');
  });

  it('is a no-op (null) when there is no active run id', () => {
    const forkRun = vi.fn(() => 'fork-1');
    expect(recordCompactionFork({ forkRun }, undefined)).toBeNull();
    expect(forkRun).not.toHaveBeenCalled();
  });

  it('is a no-op (null) when there is no store', () => {
    expect(recordCompactionFork(null, 'run-0')).toBeNull();
    expect(recordCompactionFork(undefined, 'run-0')).toBeNull();
  });

  it('never throws — swallows forkRun errors and returns null', () => {
    const forkRun = vi.fn(() => {
      throw new Error('store down');
    });
    expect(recordCompactionFork({ forkRun }, 'run-0')).toBeNull();
  });

  it('defaults the reason to "compaction"', () => {
    const forkRun = vi.fn(() => 'fork-2');
    recordCompactionFork({ forkRun }, 'run-0');
    expect(forkRun).toHaveBeenCalledWith('run-0', 'compaction');
  });
});
