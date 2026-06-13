import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleInfra } from '../../../src/commands/handlers/infra-handlers.js';

describe('infra handlers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders Ollama summary with version and Gemma readiness', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) {
        return new Response(JSON.stringify({
          models: [
            { name: 'phi4:latest' },
            { name: 'gemma4:26b-a4b-it-qat' },
          ],
        }), { status: 200 });
      }
      if (url.endsWith('/api/version')) {
        return new Response(JSON.stringify({ version: '0.30.0' }), { status: 200 });
      }
      if (url.endsWith('/v1/models')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }));

    const result = await handleInfra('status');

    expect(result.handled).toBe(true);
    expect(result.response).toContain('Ollama Summary:');
    expect(result.response).toContain('Version: 0.30.0');
    expect(result.response).toContain('Gemma 4 ready: YES');
    expect(result.response).toContain('phi4:latest');
  });

  it('marks Ollama as not Gemma-ready when version is too old', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) {
        return new Response(JSON.stringify({
          models: [{ name: 'phi4:latest' }],
        }), { status: 200 });
      }
      if (url.endsWith('/api/version')) {
        return new Response(JSON.stringify({ version: '0.24.0' }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }));

    const result = await handleInfra('health');

    expect(result.response).toContain('Version: 0.24.0');
    expect(result.response).toContain('Gemma 4 ready: NO');
  });
});
