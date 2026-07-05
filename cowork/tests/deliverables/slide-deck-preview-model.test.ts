import { describe, expect, it } from 'vitest';

import { buildSlideDeckViewModel, clampActiveIndex, normalizeSlide } from '../../src/renderer/components/deliverables/slide-deck-preview-model.js';

describe('slide deck preview model', () => {
  it('normalise les slides et retire les puces vides', () => {
    expect(normalizeSlide({ title: '  Plan  ', bullets: [' Intro ', ''], notes: ' note ' }, 0)).toEqual({
      index: 0,
      title: 'Plan',
      bullets: ['Intro'],
      notes: 'note',
      summary: 'Intro',
    });
  });

  it('borne l’index actif et expose la navigation', () => {
    const model = buildSlideDeckViewModel([{ title: 'A' }, { title: 'B' }, { title: 'C' }], 8);

    expect(model.activeIndex).toBe(2);
    expect(model.previousIndex).toBe(1);
    expect(model.nextIndex).toBeNull();
  });

  it('gère les index invalides', () => {
    expect(clampActiveIndex(Number.NaN, 2)).toBe(0);
    expect(clampActiveIndex(-3, 2)).toBe(0);
  });
});
