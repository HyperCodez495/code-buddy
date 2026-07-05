import { Table2 } from 'lucide-react';

import { EmptyState } from '../ui/EmptyState.js';
import { buildSheetViewModel, DEFAULT_VISIBLE_ROW_LIMIT, type SheetCellValue } from './sheet-preview-model.js';

export interface SheetPreviewProps {
  columns: string[];
  rows: SheetCellValue[][];
  caption?: string;
  visibleRowLimit?: number;
}

export function SheetPreview({ columns, rows, caption, visibleRowLimit = DEFAULT_VISIBLE_ROW_LIMIT }: SheetPreviewProps) {
  const model = buildSheetViewModel(columns, rows, visibleRowLimit);

  if (model.isEmpty) {
    return <EmptyState icon={<Table2 className="h-6 w-6" />} title="Feuille vide" hint="Aucune donnée tabulaire à prévisualiser." />;
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4" aria-label="Aperçu de feuille">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          {caption && <h2 className="text-sm font-semibold text-foreground">{caption}</h2>}
          <p className="text-xs text-muted-foreground tabular-nums">{model.rowCount} lignes · {model.columnCount} colonnes</p>
        </div>
        {model.hiddenRowCount > 0 && <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular-nums">+{model.hiddenRowCount} lignes</span>}
      </div>

      <div className="max-h-[32rem] overflow-auto rounded-md border border-border bg-background">
        <table className="min-w-full border-collapse text-left text-sm" role="table">
          <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
            <tr>
              {model.columns.map((column) => <th key={column} scope="col" className="border-b border-border px-3 py-2 font-medium">{column}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-foreground">
            {model.visibleRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => <td key={cellIndex} className="max-w-64 truncate px-3 py-2 tabular-nums" title={cell}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
