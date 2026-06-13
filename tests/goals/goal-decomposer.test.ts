import { describe, expect, it, vi } from 'vitest';
import type { CodeBuddyClient } from '../../src/codebuddy/client.js';
import {
  decomposeGoal,
  formatGoalPlan,
  goalPlanToCriteria,
  parseGoalPlan,
  shouldAutoDecomposeGoal,
} from '../../src/goals/goal-decomposer.js';

function mockClient(content: string): CodeBuddyClient {
  return {
    chat: vi.fn(async () => ({
      choices: [
        {
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
    })),
  } as unknown as CodeBuddyClient;
}

describe('goal-decomposer', () => {
  it('detects complex goals worth planning', () => {
    expect(shouldAutoDecomposeGoal('fix auth then add tests')).toBe(true);
    expect(shouldAutoDecomposeGoal('ship it')).toBe(false);
  });

  it('parses and sanitizes a Hermes-style task graph', () => {
    const plan = parseGoalPlan(
      JSON.stringify({
        summary: 'Build in lanes',
        tasks: [
          {
            id: 'T1',
            title: 'Research current flow',
            acceptanceCriteria: ['notes cite the current files'],
            subtasks: [
              {
                id: 'T1.1',
                title: 'Trace entry point',
                acceptanceCriteria: ['entry point path is named'],
              },
            ],
          },
          {
            id: 'T2',
            title: 'Implement and test',
            dependsOn: ['T1', 'missing', 'T2'],
            criteria: ['focused test passes'],
          },
        ],
        notes: ['T2 waits for T1'],
      })
    );

    expect(plan).not.toBeNull();
    expect(plan!.tasks).toHaveLength(2);
    expect(plan!.tasks[1]!.dependsOn).toEqual(['T1']);
    expect(plan!.tasks[0]!.subtasks[0]!.id).toBe('T1.1');
    expect(goalPlanToCriteria(plan!)).toEqual([
      'T1 Research current flow: notes cite the current files',
      'T1.1 Research current flow / Trace entry point: entry point path is named',
      'T2 Implement and test after T1: focused test passes',
    ]);
    expect(formatGoalPlan(plan!)).toContain('depends on: T1');
  });

  it('calls the LLM with a graph prompt and returns the parsed plan', async () => {
    const client = mockClient(
      JSON.stringify({
        summary: 'Two-stage plan',
        tasks: [
          { id: 'T1', title: 'Implement', acceptanceCriteria: ['diff exists'] },
          { id: 'T2', title: 'Verify', dependsOn: ['T1'], acceptanceCriteria: ['test passes'] },
        ],
      })
    );

    const plan = await decomposeGoal('implement then verify', client);

    expect(plan?.summary).toBe('Two-stage plan');
    expect(plan?.tasks[1]!.dependsOn).toEqual(['T1']);
    expect(client.chat).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: 'system' }),
        expect.objectContaining({ content: expect.stringContaining('sub-subtasks') }),
      ]),
      [],
      expect.objectContaining({ temperature: 0, maxTokens: 4096 })
    );
  });
});
