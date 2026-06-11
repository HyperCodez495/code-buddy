import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { GoalStore } from '../../src/goals/goal-store.js';
import { createGoalState } from '../../src/goals/goal-state.js';

describe('GoalStore', () => {
  let tmpDir: string;
  let store: GoalStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-store-test-'));
    store = new GoalStore({ storeDir: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves and loads a goal state', () => {
    const state = createGoalState('ship the feature', 10);
    store.save('session-1', state);
    expect(store.load('session-1')).toEqual(state);
  });

  it('returns null for unknown keys', () => {
    expect(store.load('nope')).toBeNull();
  });

  it('returns null for corrupt files', () => {
    fs.writeFileSync(path.join(tmpDir, 'bad.json'), '{not json', 'utf-8');
    expect(store.load('bad')).toBeNull();
  });

  it('deletes a stored goal', () => {
    store.save('session-1', createGoalState('g'));
    store.delete('session-1');
    expect(store.load('session-1')).toBeNull();
  });

  it('sanitizes keys so they cannot escape the store directory', () => {
    const state = createGoalState('g');
    store.save('../escape', state);
    expect(fs.existsSync(path.join(tmpDir, '.._escape.json'))).toBe(true);
    expect(store.load('../escape')).toEqual(state);
  });

  it('ignores empty keys', () => {
    store.save('', createGoalState('g'));
    expect(store.load('')).toBeNull();
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });
});
