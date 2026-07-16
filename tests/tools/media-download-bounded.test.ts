import { readBoundedResponseBytes } from '../../src/tools/media-generation-tool.js';

describe('bounded media response downloads', () => {
  it('cancels an oversized streamed body before reading it completely', async () => {
    let pullCount = 0;
    let cancelled = false;
    const chunks = [
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4]),
      new Uint8Array([5, 6]),
    ];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[pullCount];
        pullCount += 1;
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(body, { status: 200 });
    const arrayBufferSpy = vi.spyOn(response, 'arrayBuffer');

    await expect(
      readBoundedResponseBytes(response, 3, 1_000, undefined, 'test media'),
    ).rejects.toThrow('exceeds');

    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(cancelled).toBe(true);
    expect(pullCount).toBeLessThan(chunks.length + 1);
  });

  it('accepts a normal streamed body below the cap', async () => {
    const response = new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Length': '3' },
    });

    const bytes = await readBoundedResponseBytes(
      response,
      4,
      1_000,
      undefined,
      'test media',
    );

    expect(bytes).toEqual(Buffer.from([1, 2, 3]));
  });

  it('rejects an oversized declared length without consuming the body', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
    });
    const response = new Response(body, {
      status: 200,
      headers: { 'Content-Length': '5' },
    });
    const getReaderSpy = vi.spyOn(response.body!, 'getReader');

    await expect(
      readBoundedResponseBytes(response, 4, 1_000, undefined, 'test media'),
    ).rejects.toThrow('exceeds');

    expect(getReaderSpy).not.toHaveBeenCalled();
  });
});
