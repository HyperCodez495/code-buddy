/**
 * FilePreviewPane — Claude Cowork parity Phase 2 step 9
 *
 * Slide-out panel from the right edge that previews any file from the
 * workspace. Renders code with syntax highlighting (via existing
 * MessageMarkdown), images inline, PDF/Office text, or binary metadata.
 *
 * Driven by the global store: setting `previewFilePath` opens the panel,
 * setting it to null closes it.
 *
 * @module renderer/components/FilePreviewPane
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  FileText,
  Image as ImageIcon,
  FileCode,
  FileWarning,
  Loader2,
  Copy,
  Check,
} from 'lucide-react';
import { useAppStore } from '../store';
import { AgenticHarnessStrip, parseAgenticHarnessArtifact } from './agentic-harness-strip';
import { MessageMarkdown } from './MessageMarkdown';

interface PreviewResult {
  kind: 'text' | 'image' | 'pdf' | 'document' | 'binary' | 'error';
  path: string;
  name: string;
  size: number;
  mime: string;
  text?: string;
  lineCount?: number;
  language?: string;
  dataUri?: string;
  pdfText?: string;
  pdfPages?: number;
  documentText?: string;
  documentType?: string;
  documentStats?: {
    wordCount?: number;
    embeddedImageCount?: number;
    sheetCount?: number;
    slideCount?: number;
  };
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

interface FilePreviewPaneProps {
  /** Phase 3 step 8: render inline inside a split layout instead of as a fixed slide-out. */
  inline?: boolean;
}

export const FilePreviewPane: React.FC<FilePreviewPaneProps> = ({ inline = false }) => {
  const { t } = useTranslation();
  const previewFilePath = useAppStore((s) => s.previewFilePath);
  const setPreviewFilePath = useAppStore((s) => s.setPreviewFilePath);

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!previewFilePath) {
      setPreview(null);
      return;
    }
    setLoading(true);
    setCopied(false);
    (async () => {
      try {
        const api = window.electronAPI;
        if (!api?.preview?.get) {
          setPreview({
            kind: 'error',
            path: previewFilePath,
            name: previewFilePath,
            size: 0,
            mime: '',
            error: 'Preview API unavailable',
          });
          return;
        }
        const result = await api.preview.get(previewFilePath);
        setPreview(result);
      } catch (err) {
        console.error('[FilePreviewPane] failed:', err);
        setPreview({
          kind: 'error',
          path: previewFilePath,
          name: previewFilePath,
          size: 0,
          mime: '',
          error: (err as Error).message ?? 'Unknown error',
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [previewFilePath]);

  const handleClose = () => setPreviewFilePath(null);

  const handleCopy = async () => {
    if (!preview?.text && !preview?.pdfText && !preview?.documentText) return;
    try {
      await navigator.clipboard.writeText(
        preview.text ?? preview.pdfText ?? preview.documentText ?? ''
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('[FilePreviewPane] copy failed:', err);
    }
  };

  // Esc to close
  useEffect(() => {
    if (!previewFilePath) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewFilePath]);

  const agenticHarness = useMemo(() => {
    if (preview?.kind !== 'text' || !preview.text) {
      return null;
    }
    return parseAgenticHarnessArtifact(preview.text);
  }, [preview]);

  // In inline/split-pane mode, render an empty-state placeholder instead of null
  // so the split layout keeps its shape even when no file is selected.
  if (!previewFilePath && !inline) return null;

  const headerIcon =
    preview?.kind === 'image' ? (
      <ImageIcon size={14} className="text-accent" />
    ) : preview?.kind === 'pdf' ? (
      <FileText size={14} className="text-accent" />
    ) : preview?.kind === 'document' ? (
      <FileText size={14} className="text-accent" />
    ) : preview?.kind === 'text' ? (
      <FileCode size={14} className="text-accent" />
    ) : preview?.kind === 'error' ? (
      <FileWarning size={14} className="text-error" />
    ) : (
      <FileText size={14} className="text-text-muted" />
    );

  // Inline empty-state placeholder for split-pane mode.
  if (!previewFilePath && inline) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-text-muted border-l border-border-muted">
        {t('preview.emptyInline')}
      </div>
    );
  }

  const containerClasses = inline
    ? 'flex-1 min-h-0 flex flex-col bg-background border-l border-border-muted'
    : 'fixed right-0 top-0 bottom-0 w-[480px] max-w-[90vw] bg-background border-l border-border shadow-elevated z-40 flex flex-col';

  return (
    <div className={containerClasses} data-testid="file-preview-pane">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-muted shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {headerIcon}
          <div className="min-w-0">
            <div className="text-xs font-semibold text-text-primary truncate" title={preview?.name}>
              {preview?.name ?? previewFilePath}
            </div>
            {preview && (
              <div className="text-[10px] text-text-muted">
                {preview.kind} · {formatBytes(preview.size)}
                {preview.lineCount !== undefined && ` · ${preview.lineCount} ${t('preview.lines')}`}
                {preview.pdfPages !== undefined && ` · ${preview.pdfPages} ${t('preview.pages')}`}
                {preview.documentStats?.wordCount !== undefined &&
                  ` · ${preview.documentStats.wordCount} ${t('preview.words')}`}
                {preview.documentStats?.embeddedImageCount !== undefined &&
                  ` · ${preview.documentStats.embeddedImageCount} ${t('preview.images')}`}
                {preview.documentStats?.sheetCount !== undefined &&
                  ` · ${preview.documentStats.sheetCount} ${t('preview.sheets')}`}
                {preview.documentStats?.slideCount !== undefined &&
                  ` · ${preview.documentStats.slideCount} ${t('preview.slides')}`}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {(preview?.text || preview?.pdfText || preview?.documentText) && (
            <button
              onClick={handleCopy}
              className="p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-hover rounded transition-colors"
              title={t('common.copy')}
            >
              {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
            </button>
          )}
          <button
            onClick={handleClose}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-hover rounded transition-colors"
            title={t('common.close')}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-text-muted">
            <Loader2 size={14} className="animate-spin" />
            {t('common.loading')}
          </div>
        )}

        {!loading && preview?.kind === 'error' && (
          <div className="p-6 text-center">
            <FileWarning size={28} className="mx-auto text-error opacity-60 mb-2" />
            <div className="text-xs text-text-muted">{preview.error}</div>
          </div>
        )}

        {!loading && preview?.kind === 'text' && preview.text && agenticHarness && (
          <div className="p-4">
            <AgenticHarnessStrip harness={agenticHarness} sourceKind={preview.name} />
          </div>
        )}

        {!loading && preview?.kind === 'text' && preview.text && !agenticHarness && (
          <pre className="p-4 text-[11px] leading-relaxed font-mono text-text-primary whitespace-pre-wrap break-words">
            {preview.text}
          </pre>
        )}

        {!loading && preview?.kind === 'image' && preview.dataUri && (
          <div className="p-4 flex flex-col items-center gap-3">
            <img
              src={preview.dataUri}
              alt={preview.name}
              className="max-w-full max-h-[60vh] object-contain bg-surface border border-border rounded"
            />
            {preview.text && (
              <details className="w-full text-xs text-text-muted">
                <summary className="cursor-pointer hover:text-text-primary">
                  {t('preview.showSource')}
                </summary>
                <pre className="mt-2 p-3 bg-surface border border-border rounded text-[10px] font-mono whitespace-pre-wrap break-words">
                  {preview.text}
                </pre>
              </details>
            )}
          </div>
        )}

        {!loading && preview?.kind === 'pdf' && (
          <div className="p-4">
            {preview.pdfText ? (
              <MessageMarkdown normalizedText={preview.pdfText} />
            ) : (
              <div className="text-center text-xs text-text-muted py-8">
                {preview.error ?? t('preview.noPdfText')}
              </div>
            )}
          </div>
        )}

        {!loading && preview?.kind === 'document' && (
          <div className="p-4">
            {preview.documentText ? (
              <MessageMarkdown normalizedText={preview.documentText} />
            ) : (
              <div className="text-center text-xs text-text-muted py-8">
                {preview.error ?? t('preview.noDocumentText')}
              </div>
            )}
          </div>
        )}

        {!loading && preview?.kind === 'binary' && (
          <div className="p-6 text-center">
            <FileText size={28} className="mx-auto text-text-muted opacity-50 mb-2" />
            <div className="text-xs text-text-muted">
              {preview.error ?? t('preview.binaryNoPreview')}
            </div>
            <div className="text-[10px] text-text-muted opacity-70 mt-2">{preview.mime}</div>
          </div>
        )}
      </div>
    </div>
  );
};
