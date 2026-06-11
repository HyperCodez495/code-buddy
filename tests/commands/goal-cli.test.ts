import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { GoalLoopAgent, runGoalLoop } from '../../src/commands/goal-cli.js';
import { resetGoalManagers } from '../../src/goals/goal-manager.js';
import { GoalStore } from '../../src/goals/goal-store.js';

function judgeClient(replies: string[]) {
  const queue = [...replies];
  return {
    chat: vi.fn(async () => ({
      choices: [
        {
          message: { role: 'assistant', content: queue.shift() ?? replies[replies.length - 1] },
          finish_reason: 'stop',
        },
      ],
    })),
  };
}

function fakeAgent(client: ReturnType<typeof judgeClient>, responses: string[]): GoalLoopAgent {
  const queue = [...responses];
  return {
    processUserMessage: vi.fn(async () => [
      {
        type: 'assistant' as const,
        content: queue.shift() ?? 'still working',
        timestamp: new Date(),
      },
    ]),
    getClient: () => client as never,
  };
}

describe('runGoalLoop (buddy goal headless)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-cli-test-'));
    resetGoalManagers(new GoalStore({ storeDir: tmpDir }));
  });

  afterEach(() => {
    resetGoalManagers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loops with continuation prompts until the judge says done', async () => {
    const client = judgeClient([
      '{"done": false, "reason": "tests still failing"}',
      '{"done": true, "reason": "all tests pass"}',
    ]);
    const agent = fakeAgent(client, ['Fixed one test.', 'Fixed the last test. All green.']);
    const messages: string[] = [];

    const result = await runGoalLoop(agent, 'fix the tests', {
      onMessage: text => messages.push(text),
    });

    expect(result.status).toBe('done');
    expect(result.turnsUsed).toBe(2);
    expect(agent.processUserMessage).toHaveBeenCalledTimes(2);
    // Turn 1 = the goal text; turn 2 = the continuation prompt.
    expect(agent.processUserMessage).toHaveBeenNthCalledWith(1, 'fix the tests');
    expect(vi.mocked(agent.processUserMessage).mock.calls[1]![0]).toContain(
      '[Continuing toward your standing goal]'
    );
    expect(messages[0]).toContain('⊙ Goal set');
    expect(messages.some(m => m.startsWith('↻ Continuing toward goal (1/'))).toBe(true);
    expect(messages.at(-1)).toBe('✓ Goal achieved: all tests pass');
  });

  it('stops with paused status when the turn budget is exhausted', async () => {
    const client = judgeClient(['{"done": false, "reason": "not yet"}']);
    const agent = fakeAgent(client, ['progress']);

    const result = await runGoalLoop(agent, 'impossible goal', { maxTurns: 2 });

    expect(result.status).toBe('paused');
    expect(result.turnsUsed).toBe(2);
    expect(agent.processUserMessage).toHaveBeenCalledTimes(2);
  });

  it('never exceeds the iteration backstop even if the loop misbehaves', async () => {
    const client = judgeClient(['{"done": false, "reason": "never"}']);
    const agent = fakeAgent(client, ['progress']);

    const result = await runGoalLoop(agent, 'goal', { maxTurns: 3 });
    expect(vi.mocked(agent.processUserMessage).mock.calls.length).toBeLessThanOrEqual(4);
    expect(result.status).toBe('paused');
  });
});
