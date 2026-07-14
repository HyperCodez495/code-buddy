import { afterEach, describe, expect, it, vi } from 'vitest';

import { GeminiNativeProvider } from '../../../src/codebuddy/providers/provider-gemini-native.js';

function makeProvider(): GeminiNativeProvider {
  return new GeminiNativeProvider({
    apiKey: 'gemini-test-key',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash',
    defaultMaxTokens: 1_024,
    geminiRequestTimeoutMs: 60_000,
  });
}

function stallingResponseForSignal(signal: AbortSignal): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const fail = (): void => controller.error(signal.reason);
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail, { once: true });
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GeminiNativeProvider — AbortSignal transport propagation', () => {
  it('aborts non-streaming body consumption without retrying and removes the parent listener', async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    let transportSignal: AbortSignal | undefined;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      transportSignal = init?.signal as AbortSignal;
      return stallingResponseForSignal(transportSignal);
    });

    const pending = makeProvider().chat(
      [{ role: 'user', content: 'attends' }],
      [],
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(transportSignal).toBeDefined());

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(transportSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('aborts an active SSE reader instead of starting the non-streaming fallback', async () => {
    const controller = new AbortController();
    let transportSignal: AbortSignal | undefined;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      transportSignal = init?.signal as AbortSignal;
      return stallingResponseForSignal(transportSignal);
    });
    const provider = makeProvider();
    const drain = async (): Promise<void> => {
      for await (const _chunk of provider.chatStream(
        [{ role: 'user', content: 'flux' }],
        [],
        { signal: controller.signal },
      )) {
        // The stream deliberately never yields before cancellation.
      }
    };
    const pending = drain();
    await vi.waitFor(() => expect(transportSignal).toBeDefined());

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(transportSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
