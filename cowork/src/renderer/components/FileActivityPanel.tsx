/**
 * FileActivityPanel — Phase A2 (Cowork↔Hermes parity)
 *
 * Slide-out panel from the right edge listing the files the agent has
 * read / written / edited during the active session, in real time.
 * Entries are *derived* from the session's `traceSteps` (see
 * `utils/file-activity.ts`) — no new backend event is required. Clicking
 * a file opens it in the shared `FilePreviewPane` via `setPreviewFilePath`.
 *
 * @module renderer/components/FileActivityPanel
 */

import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, FilePlus, FilePen, X, type LucideIcon } from 'lucide-react';
import { useAppStore } from '../store';
import { useActiveTraceSteps, useCurrentSession } from '../store/selectors';
import { formatAppTime } from '../utils/i18n-format';
import {
  deriveFileActivity,
  groupFileActivityByOp,
  type FileActivityEntry,
  type FileActivityOp,
} from '../utils/file-activity';

interface FileActivityPanelProps {
  open: boolean;
  onClose: () => void;
}

const OP_ICONS: Record<FileActivityOp, LucideIcon> = {
  read: FileText,
  write: FilePlus,
  edit: FilePen,
};

const OP_ORDER: FileActivityOp[] = ['edit', 'write', 'read'];

/**
 * Resolve a (possibly relative) trace path against the session cwd so the
 * preview pane can load it. Absolute paths and `~`-rooted paths pass
 * through untouched. Best-effort only — see panel limits in the PR notes.
 */
function resolveForPreview(path: string, cwd?: string): string {
  if (!cwd) return path;
  const isAbsolute = path.startsWith('/') || /^[A-Za-z]:\//.test(path) || path.startsWith('~');
  if (isAbsolute) return path;
  const base = cwd.replace(/\/+$/, '');
  return `${base}/${path}`;
}

export const FileActivityPanel: React.FC<FileActivityPanelProps> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const traceSteps = useActiveTraceSteps();
  const session = useCurrentSession();
  const setPreviewFilePath = useAppStore((s) => s.setPreviewFilePath);

  const entries = useMemo(() => deriveFileActivity(traceSteps), [traceSteps]);
  const groups = useMemo(() => groupFileActivityByOp(entries), [entries]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const handleOpen = (entry: FileActivityEntry) => {
    setPreviewFilePath(resolveForPreview(entry.path, session?.cwd));
  };

  const opLabel = (op: FileActivityOp): string => t(`fileActivity.${op}`);

  return (
    <div
      className="fixed right-0 top-0 bottom-0 w-[400px] max-w-[90vw] bg-background border-l border-border shadow-elevated z-40 flex flex-col"
      data-testid="file-activity-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-muted shrink-0">
        <div className="flex items-center gap-2">
          <FilePen size={14} className="text-accent" />
          <span className="text-xs font-semibold text-text-primary">
            {t('fileActivity.title')}
          </span>
          <span className="text-[10px] text-text-muted">
            {t('fileActivity.count', { count: entries.length })}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
          title={t('common.close')}
        >
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {entries.length === 0 && (
          <div className="text-center py-12">
            <FilePen size={28} className="mx-auto text-text-muted opacity-30 mb-2" />
            <div className="text-xs text-text-muted">{t('fileActivity.empty')}</div>
          </div>
        )}

        {OP_ORDER.map((op) => {
          const opEntries = groups[op];
          if (opEntries.length === 0) return null;
          const Icon = OP_ICONS[op];
          return (
            <div key={op} className="border-b border-border-muted last:border-b-0">
              <div className="px-4 py-1.5 bg-surface/50 sticky top-0 flex items-center gap-2">
                <Icon size={11} className="text-text-muted" />
                <span className="text-[10px] uppercase tracking-wide font-semibold text-text-muted">
                  {opLabel(op)}
                </span>
                <span className="text-[10px] text-text-muted">{opEntries.length}</span>
              </div>
              {opEntries.map((entry) => (
                <button
                  key={`${op}:${entry.path}`}
                  onClick={() => handleOpen(entry)}
                  data-testid={`file-activity-entry-${entry.path}`}
                  className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-surface-hover transition-colors text-left border-l-2 border-transparent hover:border-accent"
                >
                  <Icon size={12} className="text-text-muted shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-text-primary truncate" title={entry.path}>
                      {entry.path}
                    </div>
                    <div className="text-[11px] text-text-muted truncate mt-0.5">
                      {entry.tool}
                      {entry.count > 1
                        ? ` · ${t('fileActivity.times', { count: entry.count })}`
                        : ''}
                    </div>
                  </div>
                  <span className="text-[10px] text-text-muted shrink-0">
                    {formatAppTime(entry.at)}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};
