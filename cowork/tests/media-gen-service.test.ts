/**
 * MediaGenService — real test (no mocks): injected core loader; asserts aspect
 * mapping, provider/model env overrides, and graceful error paths.
 */
import { describe, expect, it } from 'vitest';
import { MediaGenService, aspectToRatio } from '../src/main/media/media-gen-service';

describe('aspectToRatio', () => {
  it('maps GUI aspects to core aspect ratios', () => {
    expect(aspectToRatio('1:1')).toBe('square');
    expect(aspectToRatio('16:9')).toBe('landscape');
    expect(aspectToRatio('9:16')).toBe('portrait');
    expect(aspectToRatio(undefined)).toBe('square');
  });
});

describe('MediaGenService', () => {
  it('calls core generateImage with mapped aspect + env overrides and returns the path', async () => {
    const calls: Array<{ input: unknown; env?: NodeJS.ProcessEnv }> = [];
    const service = new MediaGenService(
      async () => ({
        generateImage: async (input, runtime) => {
          calls.push({ input, env: runtime?.env });
          return { outputPath: '/tmp/out/image-1.png', image: '/tmp/out/image-1.png' };
        },
      }),
      '/root',
    );

    const res = await service.generateImage({ prompt: 'a cat', aspect: '16:9', provider: 'comfyui', model: 'sd_turbo.safetensors' });
    expect(res.ok).toBe(true);
    expect(res.outputPath).toBe('/tmp/out/image-1.png');
    expect(res.url).toBe('file:///tmp/out/image-1.png');
    expect(calls[0]!.input).toEqual({ prompt: 'a cat', aspectRatio: 'landscape' });
    expect(calls[0]!.env?.CODEBUDDY_IMAGE_PROVIDER).toBe('comfyui');
    expect(calls[0]!.env?.CODEBUDDY_IMAGE_MODEL).toBe('sd_turbo.safetensors');
  });

  it('rejects an empty prompt without loading the core', async () => {
    let loaded = false;
    const service = new MediaGenService(async () => {
      loaded = true;
      return null;
    });
    const res = await service.generateImage({ prompt: '   ' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/prompt is required/);
    expect(loaded).toBe(false);
  });

  it('fails gracefully when the core module is unavailable', async () => {
    const service = new MediaGenService(async () => null);
    const res = await service.generateImage({ prompt: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/core media module unavailable/);
  });

  it('surfaces a generation error as a result, not a throw', async () => {
    const service = new MediaGenService(async () => ({
      generateImage: async () => {
        throw new Error('ComfyUI unreachable');
      },
    }));
    const res = await service.generateImage({ prompt: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ComfyUI unreachable/);
  });
});
