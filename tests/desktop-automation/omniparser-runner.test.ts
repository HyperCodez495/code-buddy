import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OmniParserRunner } from '../../src/desktop-automation/omniparser-runner.js';

/**
 * Real (mock-free) tests for the OmniParser HTTP client.
 *
 * OmniParser itself is a self-hosted GPU model, so we cannot exercise a real
 * parse here. Instead we verify the property that actually matters off-server:
 * the client degrades gracefully (no throw, original image back) when the
 * server is unreachable. The endpoint points at a port nothing is listening on,
 * so the failure is a genuine connection error — not a stubbed response.
 */
describe('OmniParserRunner', () => {
  const PNG_1PX =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  let savedUrl: string | undefined;

  beforeEach(() => {
    savedUrl = process.env.OMNIPARSER_API_URL;
    // A port that should have nothing listening -> real connection refused.
    process.env.OMNIPARSER_API_URL = 'http://127.0.0.1:59999';
  });

  afterEach(() => {
    if (savedUrl === undefined) delete process.env.OMNIPARSER_API_URL;
    else process.env.OMNIPARSER_API_URL = savedUrl;
  });

  it('falls back to the original image and no elements when the server is unreachable', async () => {
    const runner = new OmniParserRunner();
    const result = await runner.parseScreen(PNG_1PX, { width: 1920, height: 1080 });

    expect(result.elements).toEqual([]);
    expect(result.annotatedImageBase64).toBe(PNG_1PX);
  });

  it('reports the server as unavailable when /probe/ is unreachable', async () => {
    const runner = new OmniParserRunner();
    await expect(runner.isAvailable()).resolves.toBe(false);
  });
});
