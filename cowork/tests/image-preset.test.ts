import { describe, expect, it } from 'vitest';

import { IMAGE_PRESETS, buildImagePrompt } from '../src/renderer/utils/image-preset';

describe('IMAGE_PRESETS', () => {
  it('contains reusable generation presets', () => {
    expect(IMAGE_PRESETS.map((preset) => preset.id)).toContain('product');
    expect(IMAGE_PRESETS.every((preset) => preset.promptSuffix.length > 0)).toBe(true);
  });
});

describe('buildImagePrompt', () => {
  it('combines the base prompt with preset guidance', () => {
    const prompt = buildImagePrompt('  une montre connectée   ', IMAGE_PRESETS[0]!);

    expect(prompt).toContain('une montre connectée');
    expect(prompt).toContain('style: photo studio');
    expect(prompt).toContain('ratio: 4:3');
  });

  it('includes negative prompt guidance when provided', () => {
    const prompt = buildImagePrompt('portrait', {
      id: 'x',
      label: 'X',
      style: 'test',
      ratio: '1:1',
      promptSuffix: 'clean',
      negativePrompt: 'blur',
    });

    expect(prompt).toContain('avoid: blur');
  });
});
