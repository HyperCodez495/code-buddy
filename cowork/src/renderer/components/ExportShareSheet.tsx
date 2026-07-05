/**
 * ExportShareSheet — export and channel-share actions for a deliverable.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/ExportShareSheet
 */

import { useTranslation } from 'react-i18next';
import { Download, FileOutput, Link2, Send } from 'lucide-react';
import { filenameFor, mimeFor, type DeliverableRef, type ExportFormat } from '../utils/export-format';

export interface ExportShareSheetProps {
  deliverable: DeliverableRef;
  formats: ExportFormat[];
  onExport: (deliverable: DeliverableRef, format: ExportFormat) => void;
  onShare: (deliverable: DeliverableRef) => void;
}

function formatLabel(format: ExportFormat): string {
  if (format === 'markdown') return 'Markdown';
  return format.toUpperCase();
}

export function ExportShareSheet({ deliverable, formats, onExport, onShare }: ExportShareSheetProps) {
  const { t } = useTranslation();

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="export-share-sheet">
      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <FileOutput aria-hidden="true" className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground" title={deliverable.title}>
              {deliverable.title}
            </h2>
            <p className="text-xs text-muted-foreground">
              {deliverable.kind} · {formats.length} formats disponibles
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label={t('genspark.export.share', 'Partager le livrable')}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          data-testid="deliverable-share"
          onClick={() => onShare(deliverable)}
        >
          <Send aria-hidden="true" className="h-4 w-4" />
          {t('genspark.export.share', 'Partager')}
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {formats.map((format) => (
          <button
            key={format}
            type="button"
            aria-label={`Exporter en ${formatLabel(format)}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
            data-testid={`export-format-${format}`}
            onClick={() => onExport(deliverable, format)}
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{formatLabel(format)}</span>
              <span className="block truncate text-xs text-muted-foreground" title={filenameFor(deliverable, format)}>
                {filenameFor(deliverable, format)}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground" title={mimeFor(format)}>
                {mimeFor(format)}
              </span>
            </span>
            {format === 'link' ? (
              <Link2 aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <Download aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
