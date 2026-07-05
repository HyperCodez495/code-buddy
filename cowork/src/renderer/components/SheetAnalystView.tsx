/**
 * SheetAnalystView — controlled preview for web-filled analytical sheets.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/SheetAnalystView
 */

import { useTranslation } from 'react-i18next';
import { DatabaseZap, Globe2, Play, Table2 } from 'lucide-react';
import { rowsToCsv, type SheetSchema } from '../utils/sheet-schema';

export interface SheetAnalystViewProps {
  schema: SheetSchema;
  rows: string[][];
  onRun: (schema: SheetSchema) => void;
}

export function SheetAnalystView({ schema, rows, onRun }: SheetAnalystViewProps) {
  const { t } = useTranslation();
  const csv = rowsToCsv(schema, rows);

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="sheet-analyst-view">
      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <Table2 aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">{schema.title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
                <Globe2 aria-hidden="true" className="h-3.5 w-3.5" />
                {schema.source}
              </span>
              <span className="rounded-full bg-muted px-2 py-1">{schema.columns.length} colonnes</span>
              <span className="rounded-full bg-muted px-2 py-1">{rows.length} lignes</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          aria-label={t('genspark.sheet.run', 'Lancer la recherche')}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          data-testid="sheet-run"
          onClick={() => onRun(schema)}
        >
          <Play aria-hidden="true" className="h-4 w-4" />
          {t('genspark.sheet.run', 'Remplir')}
        </button>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-xs">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                {schema.columns.map((column) => (
                  <th key={column} className="border-b border-border px-3 py-2 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-background text-foreground">
              {rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-muted-foreground" colSpan={schema.columns.length}>
                    {t('genspark.sheet.empty', 'Aucun aperçu disponible.')}
                  </td>
                </tr>
              ) : (
                rows.slice(0, 8).map((row, rowIndex) => (
                  <tr key={`${rowIndex}-${row.join('|')}`} className="border-t border-border">
                    {schema.columns.map((column, columnIndex) => (
                      <td key={`${column}-${columnIndex}`} className="max-w-60 truncate px-3 py-2" title={row[columnIndex] ?? ''}>
                        {row[columnIndex] ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <details className="mt-3 rounded-lg border border-border bg-background p-3">
        <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
          <DatabaseZap aria-hidden="true" className="h-4 w-4" />
          {t('genspark.sheet.csvPreview', 'Aperçu CSV')}
        </summary>
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs text-muted-foreground">
          {csv}
        </pre>
      </details>
    </section>
  );
}
