export type SheetCellValue = string | number;

export interface SheetViewModel {
  columns: string[];
  rows: string[][];
  visibleRows: string[][];
  hiddenRowCount: number;
  rowCount: number;
  columnCount: number;
  isEmpty: boolean;
}

export const DEFAULT_VISIBLE_ROW_LIMIT = 50;

export function formatSheetCell(value: SheetCellValue | undefined): string {
  if (value === undefined) {
    return '';
  }

  return typeof value === 'number' ? new Intl.NumberFormat('fr-FR').format(value) : value;
}

export function normalizeSheetRows(rows: SheetCellValue[][], columnCount: number): string[][] {
  return rows.map((row) => Array.from({ length: columnCount }, (_, index) => formatSheetCell(row[index])));
}

export function buildSheetViewModel(
  columns: string[],
  rows: SheetCellValue[][],
  visibleRowLimit = DEFAULT_VISIBLE_ROW_LIMIT,
): SheetViewModel {
  const safeColumns = columns.map((column, index) => column.trim() || 'Colonne ' + (index + 1));
  const normalizedRows = normalizeSheetRows(rows, safeColumns.length);
  const limit = Math.max(0, Math.trunc(visibleRowLimit));
  const visibleRows = normalizedRows.slice(0, limit);

  return {
    columns: safeColumns,
    rows: normalizedRows,
    visibleRows,
    hiddenRowCount: Math.max(normalizedRows.length - visibleRows.length, 0),
    rowCount: normalizedRows.length,
    columnCount: safeColumns.length,
    isEmpty: safeColumns.length === 0 || normalizedRows.length === 0,
  };
}
