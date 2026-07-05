import { describe, expect, it } from 'vitest';

import { buildSheetViewModel, formatSheetCell, normalizeSheetRows } from '../../src/renderer/components/deliverables/sheet-preview-model.js';

describe('sheet preview model', () => {
  it('formate les nombres et complète les cellules manquantes', () => {
    expect(formatSheetCell(12345.5)).toBe('12 345,5');
    expect(normalizeSheetRows([['Alice', 2], ['Bob']], 3)).toEqual([
      ['Alice', '2', ''],
      ['Bob', '', ''],
    ]);
  });

  it('tronque les lignes visibles avec compteur', () => {
    const rows = Array.from({ length: 5 }, (_, index) => ['Ligne', index]);
    const model = buildSheetViewModel(['Nom', 'Index'], rows, 3);

    expect(model.visibleRows).toHaveLength(3);
    expect(model.hiddenRowCount).toBe(2);
    expect(model.rowCount).toBe(5);
  });

  it('détecte une feuille vide', () => {
    expect(buildSheetViewModel([], [['hors champ']]).isEmpty).toBe(true);
    expect(buildSheetViewModel(['A'], []).isEmpty).toBe(true);
  });
});
