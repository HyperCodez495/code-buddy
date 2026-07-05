import { describe, expect, it } from 'vitest';

import { buildDocViewModel, countDocWords, normalizeDocBlock } from '../../src/renderer/components/deliverables/doc-preview-model.js';

describe('doc preview model', () => {
  it('nettoie les blocs et les listes', () => {
    expect(normalizeDocBlock({ type: 'list', items: [' Un ', '', ' Deux '] })).toEqual({
      type: 'list',
      text: undefined,
      items: ['Un', 'Deux'],
      isEmpty: false,
    });
  });

  it('déduit le titre et compte les mots', () => {
    const model = buildDocViewModel([
      { type: 'p', text: 'Intro rapide' },
      { type: 'h1', text: ' Rapport final ' },
      { type: 'list', items: ['Premier point', 'Second point'] },
    ]);

    expect(model.heading).toBe('Rapport final');
    expect(model.wordCount).toBe(8);
    expect(model.isEmpty).toBe(false);
  });

  it('ignore les blocs vides', () => {
    expect(buildDocViewModel([{ type: 'p', text: ' ' }]).isEmpty).toBe(true);
    expect(countDocWords([{ type: 'p', text: 'un deux', items: [], isEmpty: false }])).toBe(2);
  });
});
