import { describe, expect, it, vi } from 'vitest';
import {
  bootstrapDarkstarNetworkModel,
  DARKSTAR_OLLAMA_BASE_URL,
  DARKSTAR_OLLAMA_PROBE_URL,
  findDarkstarPeer,
  resolveDarkstarTailnetBaseUrl,
} from '../src/main/config/darkstar-network-model';

describe('bootstrapDarkstarNetworkModel', () => {
  it('resolves the darkstar Ollama base url from tailscale status when available', async () => {
    const target = await resolveDarkstarTailnetBaseUrl(async () => ({
      Peer: {
        'node-1': {
          HostName: 'DARKSTAR',
          DNSName: 'darkstar.tail2a752c.ts.net',
          TailscaleIPs: ['100.73.222.64'],
          Online: true,
        },
      },
    }));

    expect(target).toEqual({
      baseUrl: 'http://100.73.222.64:11434/v1',
      probeUrl: 'http://100.73.222.64:11434/api/tags',
      source: 'tailscale',
    });
  });

  it('falls back to the static darkstar endpoint when tailscale discovery is unavailable', async () => {
    const target = await resolveDarkstarTailnetBaseUrl(async () => null);

    expect(target).toEqual({
      baseUrl: DARKSTAR_OLLAMA_BASE_URL,
      probeUrl: DARKSTAR_OLLAMA_PROBE_URL,
      source: 'fallback',
    });
  });

  it('finds a darkstar peer from tailscale status payloads', () => {
    expect(
      findDarkstarPeer({
        Peer: {
          'node-1': {
            HostName: 'DARKSTAR',
            TailscaleIPs: ['100.73.222.64'],
            Online: true,
          },
        },
      })
    ).toEqual({ hostname: 'DARKSTAR', ip: '100.73.222.64' });
  });

  it('boots a preferred darkstar network model when Ollama is reachable', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe(DARKSTAR_OLLAMA_PROBE_URL);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { model: 'phi4:latest' },
            { model: 'qwen3.6:27b' },
            { model: 'qwen3.6:35b-a3b-q4_K_M' },
          ],
        }),
      } as Response;
    });

    const env: NodeJS.ProcessEnv = {};
    const result = await bootstrapDarkstarNetworkModel(
      env,
      fetchImpl as unknown as typeof fetch,
      async () => null
    );

    expect(result).toMatchObject({
      applied: true,
      baseUrl: DARKSTAR_OLLAMA_BASE_URL,
      model: 'qwen3.6:35b-a3b-q4_K_M',
    });
    expect(env.CODEBUDDY_NETWORK_MODELS).toBe(
      `qwen3.6:35b-a3b-q4_K_M@${DARKSTAR_OLLAMA_BASE_URL}`
    );
  });

  it('skips Gemma 4 priority when Ollama is too old', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/api/version')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ version: '0.24.0' }),
        } as Response;
      }
      expect(url).toBe(DARKSTAR_OLLAMA_PROBE_URL);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { model: 'gemma4:26b-a4b-it-qat' },
            { model: 'phi4:latest' },
          ],
        }),
      } as Response;
    });

    const env: NodeJS.ProcessEnv = {};
    const result = await bootstrapDarkstarNetworkModel(
      env,
      fetchImpl as unknown as typeof fetch,
      async () => null
    );

    expect(result).toMatchObject({
      applied: true,
      model: 'phi4:latest',
    });
    expect(env.CODEBUDDY_NETWORK_MODELS).toBe(`phi4:latest@${DARKSTAR_OLLAMA_BASE_URL}`);
  });

  it('skips bootstrap when explicit network models are already configured', async () => {
    const env: NodeJS.ProcessEnv = {
      CODEBUDDY_NETWORK_MODELS: 'devstral@http://g7:11434/v1',
    };
    const fetchImpl = vi.fn();

    const result = await bootstrapDarkstarNetworkModel(
      env,
      fetchImpl as unknown as typeof fetch,
      async () => null
    );

    expect(result.applied).toBe(false);
    expect(result.reason).toContain('already set');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
