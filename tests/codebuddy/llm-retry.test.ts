import {
  classifyLlmError,
  withLlmRetry,
  withLlmStreamRetry,
} from '../../src/codebuddy/llm-retry.js';

describe('LLM retry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }), 'retryable'],
    [Object.assign(new Error('Too many requests'), { status: 429 }), 'retryable'],
    [Object.assign(new Error('upstream unavailable'), { status: 503 }), 'retryable'],
    [new Error('LLM stream stalled: no data received'), 'retryable'],
    [new Error('stream was terminated unexpectedly'), 'retryable'],
    [new Error('maximum context length exceeded'), 'terminal'],
    [Object.assign(new Error('insufficient quota'), { status: 429, code: 'insufficient_quota' }), 'terminal'],
    [Object.assign(new Error('Unauthorized'), { status: 401 }), 'terminal'],
  ])('classifies %s as %s', (error, expected) => {
    expect(classifyLlmError(error)).toBe(expected);
  });

  it('retries retryable failures with exponential backoff and then succeeds', async () => {
    vi.useFakeTimers();
    const operation = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))
      .mockRejectedValueOnce(Object.assign(new Error('overloaded'), { status: 503 }))
      .mockResolvedValue('ok');
    const retries: Array<[number, number]> = [];

    const result = withLlmRetry(operation, {
      maxRetries: 2,
      baseDelayMs: 100,
      onRetry: (retry, _max, delayMs) => retries.push([retry, delayMs]),
    });
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
    expect(retries).toEqual([[1, 100], [2, 200]]);
  });

  it('does not retry terminal failures', async () => {
    const operation = vi.fn().mockRejectedValue(
      Object.assign(new Error('invalid API key'), { status: 401 }),
    );
    await expect(withLlmRetry(operation, { maxRetries: 2, baseDelayMs: 0 })).rejects.toThrow(
      'invalid API key',
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('honours Retry-After metadata', async () => {
    vi.useFakeTimers();
    const delays: number[] = [];
    const operation = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), {
        status: 429,
        headers: { 'retry-after': '2' },
      }))
      .mockResolvedValue('ok');

    const result = withLlmRetry(operation, {
      baseDelayMs: 10,
      onRetry: (_retry, _max, delayMs) => delays.push(delayMs),
    });
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe('ok');
    expect(delays).toEqual([2_000]);
  });

  it('stops a pending retry when aborted', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const operation = vi.fn().mockRejectedValue(
      Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
    );
    const result = withLlmRetry(operation, {
      maxRetries: 2,
      baseDelayMs: 10_000,
      signal: controller.signal,
    });

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('aborts an in-flight operation that has not settled', async () => {
    const controller = new AbortController();
    const result = withLlmRetry(() => new Promise<string>(() => {}), {
      signal: controller.signal,
    });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('surfaces a retry event before restarting a failed stream', async () => {
    let attempts = 0;
    const factory = () => (async function* () {
      attempts++;
      if (attempts === 1) throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
      yield 'done';
    })();
    const events = [];
    for await (const event of withLlmStreamRetry(factory, { baseDelayMs: 0 })) {
      events.push(event);
    }
    expect(events).toEqual([
      expect.objectContaining({ type: 'retry', retry: 1, maxRetries: 2 }),
      { type: 'value', value: 'done' },
    ]);
  });
});
