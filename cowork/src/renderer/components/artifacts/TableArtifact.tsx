/**
 * TableArtifact — a GFM data table rendered as an interactive grid.
 *
 * Click-to-sort column headers (numeric-aware, toggle asc/desc) and a
 * "Download CSV" button. Dependency-free: the sort + CSV logic lives in the
 * pure `table-csv` util so it can be unit-tested without a DOM.
 *
 * @module renderer/components/artifacts/TableArtifact
 */

import React, { useCallback, useMemo, useState } from 'react';
import { ArrowUp, ArrowDown, Download } from 'lucide-react';
import type { TableArtifactData } from '../../utils/artifact-detector';
import { sortTableRows, tableToCsv } from '../../utils/table-csv';

export const TableArtifact: React.FC<{ table: TableArtifactData }> = ({ table }) => {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const rows = useMemo(() => {
    if (sortCol === null) return table.rows;
    return sortTableRows(table.rows, sortCol, sortDir);
  }, [table.rows, sortCol, sortDir]);

  const toggleSort = useCallback((col: number) => {
    setSortCol((prev) => {
      if (prev === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return col;
      }
      setSortDir('asc');
      return col;
    });
  }, []);

  const handleCsv = useCallback(() => {
    const csv = tableToCsv(table.headers, table.rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(table.title ?? 'table').replace(/[^\w.-]+/g, '_')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [table]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-muted shrink-0">
        <div className="text-[11px] text-text-muted">
          {table.rows.length} × {table.headers.length}
        </div>
        <button
          type="button"
          onClick={handleCsv}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] bg-surface hover:bg-surface-hover border border-border rounded-md transition-colors"
        >
          <Download size={11} />
          CSV
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead className="sticky top-0 bg-background z-10">
            <tr>
              {table.headers.map((h, ci) => {
                const active = sortCol === ci;
                return (
                  <th
                    key={ci}
                    onClick={() => toggleSort(ci)}
                    className="text-left font-semibold text-text-primary px-3 py-2 border-b border-border cursor-pointer select-none hover:bg-surface-hover whitespace-nowrap"
                  >
                    <span className="inline-flex items-center gap-1">
                      {h || '—'}
                      {active &&
                        (sortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="odd:bg-surface/30 hover:bg-surface-hover">
                {table.headers.map((_, ci) => (
                  <td
                    key={ci}
                    className="px-3 py-1.5 border-b border-border-muted align-top text-text-primary break-words"
                  >
                    {row[ci] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
