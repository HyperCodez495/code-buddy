/**
 * ArtifactPanel — Claude Cowork parity Phase 2 step 10
 *
 * Slide-out panel that renders artifacts detected in assistant messages:
 * HTML (sandboxed iframe), SVG (inline), Mermaid (client-side render),
 * React/JSX (source only), JSON (pretty-printed).
 *
 * Driven by store.activeArtifact — setting it opens the panel.
 *
 * @module renderer/components/ArtifactPanel
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Code2, Eye, Copy, Check, Download } from 'lucide-react';
import { useAppStore } from '../store';
import { AgenticHarnessStrip, parseAgenticHarnessArtifact } from './agentic-harness-strip';

type TabKey = 'preview' | 'source';

function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build a self-contained HTML document for the iframe sandbox.
 * Mermaid loads from a local copy bundled with the renderer (or CDN fallback
 * if not available — gated by CSP in the iframe).
 */
function buildIframeDoc(kind: 'html' | 'svg' | 'mermaid', source: string): string {
  if (kind === 'html') {
    // If the source is a full HTML document, use it as-is.
    if (/<html[\s>]/i.test(source)) return source;
    // Otherwise wrap it with a minimal shell.
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Artifact</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 16px; color: #111; background: #fff; }
  </style>
</head>
<body>
${source}
</body>
</html>`;
  }

  if (kind === 'svg') {
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; padding: 16px; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #fff; }
    svg { max-width: 100%; max-height: 100%; }
  </style>
</head>
<body>
${source}
</body>
</html>`;
  }

  if (kind === 'mermaid') {
    const escaped = escapeHtml(source);
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
  <style>
    body { font-family: system-ui, sans-serif; margin: 16px; background: #fff; }
    .mermaid { background: #fff; }
  </style>
</head>
<body>
  <div class="mermaid">${escaped}</div>
  <script>
    if (window.mermaid) {
      window.mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'strict' });
    }
  </script>
</body>
</html>`;
  }

  return '';
}

export const ArtifactPanel: React.FC = () => {
  const { t } = useTranslation();
  const activeArtifact = useAppStore((s) => s.activeArtifact);
  const setActiveArtifact = useAppStore((s) => s.setActiveArtifact);
  const [tab, setTab] = useState<TabKey>('preview');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!activeArtifact) return;
    setTab('preview');
    setCopied(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveArtifact(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeArtifact, setActiveArtifact]);

  const iframeDoc = useMemo(() => {
    if (!activeArtifact) return '';
    if (
      activeArtifact.kind === 'html' ||
      activeArtifact.kind === 'svg' ||
      activeArtifact.kind === 'mermaid'
    ) {
      return buildIframeDoc(activeArtifact.kind, activeArtifact.source);
    }
    return '';
  }, [activeArtifact]);

  const agenticHarness = useMemo(() => {
    if (!activeArtifact || activeArtifact.kind !== 'json') {
      return null;
    }
    return parseAgenticHarnessArtifact(activeArtifact.source);
  }, [activeArtifact]);

  if (!activeArtifact) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeArtifact.source);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('[ArtifactPanel] copy failed:', err);
    }
  };

  const handleDownload = () => {
    const ext =
      activeArtifact.kind === 'html'
        ? 'html'
        : activeArtifact.kind === 'svg'
          ? 'svg'
          : activeArtifact.kind === 'mermaid'
            ? 'mmd'
            : activeArtifact.kind === 'json'
              ? 'json'
              : 'txt';
    const blob = new Blob([activeArtifact.source], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeArtifact.title ?? activeArtifact.id}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const canPreview =
    activeArtifact.kind === 'html' ||
    activeArtifact.kind === 'svg' ||
    activeArtifact.kind === 'mermaid' ||
    Boolean(agenticHarness);

  return (
    <div className="fixed right-0 top-0 bottom-0 w-[560px] max-w-[90vw] bg-background border-l border-border shadow-elevated z-40 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-muted shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Code2 size={14} className="text-accent shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-text-primary truncate">
              {activeArtifact.title ?? t(`artifact.kind.${activeArtifact.kind}`)}
            </div>
            <div className="text-[10px] text-text-muted uppercase tracking-wide">
              {activeArtifact.kind} · {activeArtifact.source.length} {t('artifact.chars')}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleCopy}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-hover rounded transition-colors"
            title={t('common.copy')}
          >
            {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
          </button>
          <button
            onClick={handleDownload}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-hover rounded transition-colors"
            title={t('common.download')}
          >
            <Download size={12} />
          </button>
          <button
            onClick={() => setActiveArtifact(null)}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-hover rounded transition-colors"
            title={t('common.close')}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      {canPreview && (
        <div className="flex border-b border-border-muted shrink-0">
          <button
            onClick={() => setTab('preview')}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs border-b-2 transition-colors ${
              tab === 'preview'
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            <Eye size={12} />
            {t('artifact.preview')}
          </button>
          <button
            onClick={() => setTab('source')}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs border-b-2 transition-colors ${
              tab === 'source'
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            <Code2 size={12} />
            {t('artifact.source')}
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto">
        {canPreview && tab === 'preview' && activeArtifact.kind !== 'json' && (
          <iframe
            key={activeArtifact.id}
            title="artifact-preview"
            sandbox="allow-scripts"
            srcDoc={iframeDoc}
            className="w-full h-full border-0 bg-white"
          />
        )}
        {agenticHarness && tab === 'preview' && (
          <div className="p-4">
            <AgenticHarnessStrip
              harness={agenticHarness}
              sourceKind={activeArtifact.title ?? activeArtifact.language}
            />
          </div>
        )}
        {(tab === 'source' || !canPreview) && (
          <pre className="p-4 text-[11px] leading-relaxed font-mono text-text-primary whitespace-pre-wrap break-words">
            {activeArtifact.source}
          </pre>
        )}
      </div>
    </div>
  );
};
