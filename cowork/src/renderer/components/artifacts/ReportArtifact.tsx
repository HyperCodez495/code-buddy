/**
 * ReportArtifact — cited research report rendered as a Sparkpage.
 *
 * Two-pane layout inside the ArtifactPanel body: the report markdown body on
 * the left (via the shared MessageMarkdown), a clickable Sources rail on the
 * right. External links open via the renderer's `openExternal` bridge, falling
 * back to a plain new-tab open.
 *
 * @module renderer/components/artifacts/ReportArtifact
 */

import React, { useCallback } from 'react';
import { ExternalLink } from 'lucide-react';
import { MessageMarkdown } from '../MessageMarkdown';
import type { ReportArtifactData } from '../../utils/artifact-detector';

function openUrl(url: string): void {
  if (typeof window === 'undefined') return;
  if (window.electronAPI?.openExternal) {
    void window.electronAPI.openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export const ReportArtifact: React.FC<{ report: ReportArtifactData }> = ({ report }) => {
  const handleSourceClick = useCallback((url?: string) => {
    if (url) openUrl(url);
  }, []);

  return (
    <div className="flex h-full min-h-0">
      {/* Main report body */}
      <div className="flex-1 min-w-0 overflow-auto p-5" data-report-export-root>
        <MessageMarkdown normalizedText={report.body} />
      </div>

      {/* Sources rail */}
      <aside className="w-[220px] shrink-0 border-l border-border-muted overflow-auto bg-surface/30">
        <div className="px-3 py-2 border-b border-border-muted sticky top-0 bg-background/95 backdrop-blur z-10">
          <div className="text-[11px] font-semibold text-text-primary uppercase tracking-wide">
            Sources · {report.sources.length}
          </div>
        </div>
        <ul className="p-2 space-y-1.5">
          {report.sources.map((s) => {
            const clickable = Boolean(s.url);
            return (
              <li key={s.n}>
                <button
                  type="button"
                  id={`report-source-${s.n}`}
                  disabled={!clickable}
                  onClick={() => handleSourceClick(s.url)}
                  title={s.url ?? s.label}
                  className={`w-full text-left rounded-md border border-border px-2.5 py-2 transition-colors ${
                    clickable ? 'hover:bg-surface-hover cursor-pointer' : 'cursor-default opacity-90'
                  }`}
                >
                  <div className="flex items-start gap-1.5">
                    <span className="text-[10px] font-mono text-accent shrink-0 mt-0.5">
                      [{s.n}]
                    </span>
                    <span className="text-[11px] text-text-primary break-words leading-snug">
                      {s.label}
                    </span>
                    {clickable && (
                      <ExternalLink size={10} className="text-text-muted shrink-0 mt-0.5" />
                    )}
                  </div>
                  {(s.page || s.section) && (
                    <div className="flex flex-wrap gap-1 mt-1 pl-5">
                      {s.page && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface-muted text-text-muted">
                          p.{s.page}
                        </span>
                      )}
                      {s.section && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface-muted text-text-muted">
                          {s.section}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
};
