import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAX_TURNS,
  buildContinuationPrompt,
  createGoalState,
  formatGoalStatusLine,
  normalizeGoalState,
  renderSubgoalsBlock,
  truncateText,
} from '../../src/goals/goal-state.js';

describe('goal-state', () => {
  describe('normalizeGoalState', () => {
    it('round-trips a freshly created state', () => {
      const state = createGoalState('ship the feature', 10);
      const restored = normalizeGoalState(JSON.parse(JSON.stringify(state)));
      expect(restored).toEqual(state);
    });

    it('loads legacy payloads without subgoals', () => {
      const restored = normalizeGoalState({
        goal: 'fix tests',
        status: 'paused',
        turnsUsed: 5,
        maxTurns: 20,
        createdAt: 123,
        lastTurnAt: 456,
        consecutiveParseFailures: 1,
        pausedReason: 'turn budget exhausted (20/20)',
      });
      expect(restored).not.toBeNull();
      expect(restored!.subgoals).toEqual([]);
      expect(restored!.status).toBe('paused');
      expect(restored!.pausedReason).toBe('turn budget exhausted (20/20)');
    });

    it('rejects payloads without goal text', () => {
      expect(normalizeGoalState({ status: 'active' })).toBeNull();
      expect(normalizeGoalState(null)).toBeNull();
      expect(normalizeGoalState('not an object')).toBeNull();
    });

    it('coerces bad numbers and unknown statuses to defaults', () => {
      const restored = normalizeGoalState({
        goal: 'g',
        status: 'bogus',
        turnsUsed: 'NaN?',
        maxTurns: 0,
        subgoals: ['  a  ', '', 42],
      });
      expect(restored!.status).toBe('active');
      expect(restored!.turnsUsed).toBe(0);
      expect(restored!.maxTurns).toBe(DEFAULT_MAX_TURNS);
      expect(restored!.subgoals).toEqual(['a', '42']);
    });
  });

  describe('formatGoalStatusLine', () => {
    it('formats the no-goal case', () => {
      expect(formatGoalStatusLine(null)).toBe('No active goal. Set one with /goal <text>.');
      const cleared = { ...createGoalState('g'), status: 'cleared' as const };
      expect(formatGoalStatusLine(cleared)).toBe('No active goal. Set one with /goal <text>.');
    });

    it('formats active goals with turn counter and subgoal count', () => {
      const state = createGoalState('Fix every failing test', 20);
      state.turnsUsed = 3;
      expect(formatGoalStatusLine(state)).toBe('⊙ Goal (active, 3/20 turns): Fix every failing test');
      state.subgoals = ['include a regression test', 'run lint'];
      expect(formatGoalStatusLine(state)).toBe(
        '⊙ Goal (active, 3/20 turns, 2 subgoals): Fix every failing test'
      );
      state.subgoals = ['one'];
      expect(formatGoalStatusLine(state)).toBe(
        '⊙ Goal (active, 3/20 turns, 1 subgoal): Fix every failing test'
      );
    });

    it('formats paused goals with reason', () => {
      const state = createGoalState('g', 20);
      state.status = 'paused';
      state.turnsUsed = 20;
      state.pausedReason = 'turn budget exhausted (20/20)';
      expect(formatGoalStatusLine(state)).toBe(
        '⏸ Goal (paused, 20/20 turns — turn budget exhausted (20/20)): g'
      );
    });

    it('formats done goals', () => {
      const state = createGoalState('g', 20);
      state.status = 'done';
      state.turnsUsed = 10;
      expect(formatGoalStatusLine(state)).toBe('✓ Goal done (10/20 turns): g');
    });
  });

  describe('renderSubgoalsBlock', () => {
    it('renders a 1-based numbered list', () => {
      expect(renderSubgoalsBlock(['a', 'b'])).toBe('- 1. a\n- 2. b');
      expect(renderSubgoalsBlock([])).toBe('');
    });
  });

  describe('buildContinuationPrompt', () => {
    it('uses the plain template without subgoals', () => {
      const prompt = buildContinuationPrompt(createGoalState('ship it'));
      expect(prompt).toContain('[Continuing toward your standing goal]');
      expect(prompt).toContain('Goal: ship it');
      expect(prompt).toContain('Take the next concrete step.');
      expect(prompt).not.toContain('Additional criteria');
    });

    it('lists subgoals in the with-subgoals template', () => {
      const state = createGoalState('ship it');
      state.subgoals = ['include a regression test'];
      const prompt = buildContinuationPrompt(state);
      expect(prompt).toContain('Additional criteria the user added mid-loop:');
      expect(prompt).toContain('- 1. include a regression test');
      expect(prompt).toContain('goal AND all additional criteria');
    });
  });

  describe('truncateText', () => {
    it('truncates long text with a marker', () => {
      expect(truncateText('abcdef', 3)).toBe('abc… [truncated]');
      expect(truncateText('abc', 3)).toBe('abc');
      expect(truncateText('', 3)).toBe('');
    });
  });
});
