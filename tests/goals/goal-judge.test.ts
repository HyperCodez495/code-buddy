import { describe, it, expect, vi, beforeEach } from 'vitest';
import { judgeGoal, parseJudgeResponse } from '../../src/goals/goal-judge.js';
import { JUDGE_SYSTEM_PROMPT } from '../../src/goals/goal-state.js';

const recordUsageSpy = vi.hoisted(() => vi.fn());
vi.mock('../../src/utils/cost-tracker.js', () => ({
  getCostTracker: () => ({ recordUsage: recordUsageSpy }),
}));

beforeEach(() => {
  recordUsageSpy.mockClear();
});

function mockClient(content: string) {
  return {
    chat: vi.fn().mockResolvedValue({
      choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    }),
  } as any;
}

describe('judgeGoal', () => {
  it('returns done verdict from valid JSON', async () => {
    const client = mockClient('{"done": true, "reason": "tests are green"}');
    const result = await judgeGoal(client, { goal: 'fix tests', lastResponse: 'All 30 tests pass.' });
    expect(result).toEqual({ verdict: 'done', reason: 'tests are green', parseFailed: false });
  });

  it('parses fenced JSON', async () => {
    const client = mockClient('```json\n{"done": false, "reason": "two tests still fail"}\n```');
    const result = await judgeGoal(client, { goal: 'fix tests', lastResponse: 'Working on it.' });
    expect(result.verdict).toBe('continue');
    expect(result.reason).toBe('two tests still fail');
    expect(result.parseFailed).toBe(false);
  });

  it('coerces string done values like Hermes', async () => {
    const client = mockClient('{"done": "true", "reason": "ok"}');
    const result = await judgeGoal(client, { goal: 'g', lastResponse: 'r' });
    expect(result.verdict).toBe('done');
  });

  it('flags prose replies as parse failures (fail-open continue)', async () => {
    const client = mockClient('The goal looks mostly complete to me!');
    const result = await judgeGoal(client, { goal: 'g', lastResponse: 'r' });
    expect(result.verdict).toBe('continue');
    expect(result.parseFailed).toBe(true);
  });

  it('flags empty replies as parse failures', async () => {
    const client = mockClient('');
    const result = await judgeGoal(client, { goal: 'g', lastResponse: 'r' });
    expect(result.verdict).toBe('continue');
    expect(result.parseFailed).toBe(true);
    expect(result.reason).toContain('empty response');
  });

  it('treats transport errors as continue WITHOUT parse failure', async () => {
    const client = { chat: vi.fn().mockRejectedValue(new Error('ECONNRESET')) } as any;
    const result = await judgeGoal(client, { goal: 'g', lastResponse: 'r' });
    expect(result.verdict).toBe('continue');
    expect(result.parseFailed).toBe(false);
    expect(result.reason).toContain('judge error');
  });

  it('times out hung judge calls as continue without parse failure', async () => {
    const client = { chat: vi.fn().mockReturnValue(new Promise(() => {})) } as any;
    const result = await judgeGoal(client, { goal: 'g', lastResponse: 'r', timeoutMs: 20 });
    expect(result.verdict).toBe('continue');
    expect(result.parseFailed).toBe(false);
  });

  it('skips judging when the goal is empty', async () => {
    const client = mockClient('{"done": true, "reason": "x"}');
    const result = await judgeGoal(client, { goal: '   ', lastResponse: 'r' });
    expect(result.verdict).toBe('skipped');
    expect(client.chat).not.toHaveBeenCalled();
  });

  it('continues without judging when the response is empty', async () => {
    const client = mockClient('{"done": true, "reason": "x"}');
    const result = await judgeGoal(client, { goal: 'g', lastResponse: '  ' });
    expect(result.verdict).toBe('continue');
    expect(result.parseFailed).toBe(false);
    expect(client.chat).not.toHaveBeenCalled();
  });

  it('continues when no client is available', async () => {
    const result = await judgeGoal(null, { goal: 'g', lastResponse: 'r' });
    expect(result.verdict).toBe('continue');
    expect(result.parseFailed).toBe(false);
  });

  it('forwards the judge model override and temperature 0', async () => {
    const client = mockClient('{"done": false, "reason": "x"}');
    await judgeGoal(client, { goal: 'g', lastResponse: 'r', model: 'qwen3:8b' });
    expect(client.chat).toHaveBeenCalledWith(
      [
        { role: 'system', content: JUDGE_SYSTEM_PROMPT },
        { role: 'user', content: expect.stringContaining('Is the goal satisfied?') },
      ],
      [],
      { model: 'qwen3:8b', temperature: 0 }
    );
  });

  it('omits the model option when none is configured', async () => {
    const client = mockClient('{"done": false, "reason": "x"}');
    await judgeGoal(client, { goal: 'g', lastResponse: 'r' });
    expect(client.chat.mock.calls[0]![2]).toEqual({ temperature: 0 });
  });

  it('truncates long responses to the 4000-char snippet', async () => {
    const client = mockClient('{"done": false, "reason": "x"}');
    await judgeGoal(client, { goal: 'g', lastResponse: 'x'.repeat(10_000) });
    const userPrompt = client.chat.mock.calls[0]![0][1].content as string;
    expect(userPrompt).toContain('… [truncated]');
    expect(userPrompt.length).toBeLessThan(5000);
  });

  it('records the judge call cost from response usage', async () => {
    const client = {
      chat: vi.fn().mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: '{"done": false, "reason": "x"}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 120, completion_tokens: 18, total_tokens: 138 },
      }),
      getCurrentModel: vi.fn(() => 'gpt-5.5'),
    } as any;
    await judgeGoal(client, { goal: 'g', lastResponse: 'r' });
    expect(recordUsageSpy).toHaveBeenCalledWith(120, 18, 'gpt-5.5');

    recordUsageSpy.mockClear();
    await judgeGoal(client, { goal: 'g', lastResponse: 'r', model: 'qwen3:8b' });
    expect(recordUsageSpy).toHaveBeenCalledWith(120, 18, 'qwen3:8b');
  });

  it('skips cost recording when the provider returns no usage', async () => {
    const client = mockClient('{"done": false, "reason": "x"}');
    await judgeGoal(client, { goal: 'g', lastResponse: 'r' });
    expect(recordUsageSpy).not.toHaveBeenCalled();
  });

  it('switches to the with-subgoals template when subgoals exist', async () => {
    const client = mockClient('{"done": false, "reason": "x"}');
    await judgeGoal(client, {
      goal: 'g',
      lastResponse: 'r',
      subgoals: ['include a regression test'],
    });
    const userPrompt = client.chat.mock.calls[0]![0][1].content as string;
    expect(userPrompt).toContain('- 1. include a regression test');
    expect(userPrompt).toContain('every additional criterion satisfied?');
  });
});

describe('parseJudgeResponse', () => {
  it('flags mid-string truncated JSON as a parse failure (counts toward auto-pause)', () => {
    const result = parseJudgeResponse('{"done": true, "reason": "The agent successfully');
    expect(result.verdict).toBe('continue');
    expect(result.parseFailed).toBe(true);
  });

  it('defaults missing reason', () => {
    const result = parseJudgeResponse('{"done": false}');
    expect(result.reason).toBe('no reason provided');
  });

  it('rejects JSON arrays as parse failures', () => {
    const result = parseJudgeResponse('[1, 2]');
    expect(result.parseFailed).toBe(true);
  });
});
