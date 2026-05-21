/**
 * InlineDiffPreview — P4.7
 *
 * Renders a compact unified-diff preview directly in chat. Used when a
 * tool_use block is about to edit a file — the message renderer can drop
 * this in to show the user what's about to happen with Accept / Reject
 * actions inline.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, FileEdit } from 'lucide-react';

interface InlineDiffPreviewProps {
  filePath: string;
  oldText?: string;
  newText: string;
  onAccept?: () => void;
  onReject?: () => void;
}

interface DiffLine {
  kind: '+' | '-' | ' ';
  text: string;
}

function computeNaiveDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  // Naive line-by-line diff — sufficient for an at-a-glance preview.
  const out: DiffLine[] = [];
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === undefined) {
      out.push({ kind: '+', text: n });
    } else if (n === undefined) {
      out.push({ kind: '-', text: o });
    } else if (o === n) {
      out.push({ kind: ' ', text: o });
    } else {
      out.push({ kind: '-', text: o });
      out.push({ kind: '+', text: n });
    }
  }
  return out;
}

export function InlineDiffPreview({ filePath, oldText, newText, onAccept, onReject }: InlineDiffPreviewProps) {
  const { t } = useTranslation();
  const diff = useMemo(() => computeNaiveDiff(oldText ?? '', newText), [oldText, newText]);
  const added = diff.filter((l) => l.kind === '+').length;
  const removed = diff.filter((l) => l.kind === '-').length;

  return (
    <div className="border border-border-subtle rounded-lg overflow-hidden text-xs" data-testid={`inline-diff-${filePath}`}>
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface/50 border-b border-border-subtle">
        <div className="flex items-center gap-2 min-w-0">
          <FileEdit size={12} className="text-accent shrink-0" />
          <span className="font-mono truncate">{filePath}</span>
          <span className="text-success shrink-0">+{added}</span>
          <span className="text-error shrink-0">-{removed}</span>
        </div>
        {(onAccept || onReject) && (
          <div className="flex items-center gap-1 shrink-0">
            {onReject && (
              <button
                type="button"
                onClick={onReject}
                className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded text-error hover:bg-error/10"
                data-testid={`inline-diff-reject-${filePath}`}
              >
                <X size={10} />
                {t('inlineDiff.reject', 'Reject')}
              </button>
            )}
            {onAccept && (
              <button
                type="button"
                onClick={onAccept}
                className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded text-success hover:bg-success/10"
                data-testid={`inline-diff-accept-${filePath}`}
              >
                <Check size={10} />
                {t('inlineDiff.accept', 'Accept')}
              </button>
            )}
          </div>
        )}
      </div>
      <pre className="bg-background font-mono text-[11px] leading-tight overflow-x-auto max-h-64">
        {diff.map((line, i) => (
          <div
            key={i}
            className={`px-3 py-0.5 ${
              line.kind === '+'
                ? 'bg-success/10 text-success'
                : line.kind === '-'
                  ? 'bg-error/10 text-error'
                  : 'text-text-secondary'
            }`}
          >
            <span className="select-none mr-2 opacity-60">{line.kind}</span>
            {line.text}
          </div>
        ))}
      </pre>
    </div>
  );
}
