/**
 * ExportShareableDialog — P4.2
 *
 * Exports the active session as HTML (self-contained), via a Blob download,
 * or opens the same HTML in a new tab where the OS print dialog can save
 * it as PDF. Also creates a share link via the session.share bridge when
 * available.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Download, FileText, Link2, Printer } from 'lucide-react';
import { useAppStore } from '../store';
import { useActiveSessionMessages } from '../store/selectors';

interface ExportShareableDialogProps {
  onClose: () => void;
}

function renderSessionAsHtml(title: string, messages: ReturnType<typeof useActiveSessionMessages>): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = messages
    .map((m) => {
      const text = Array.isArray(m.content)
        ? (m.content as Array<{ type?: string; text?: string }>)
            .filter((b) => b.type === 'text')
            .map((b) => b.text ?? '')
            .join('\n\n')
        : String(m.content ?? '');
      const role = m.role === 'user' ? 'User' : 'Assistant';
      return `<section class="msg ${m.role}"><h3>${role}</h3><pre>${escape(text)}</pre></section>`;
    })
    .join('\n');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escape(title)}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 880px; margin: 2rem auto; padding: 0 1rem; line-height: 1.55; color: #1a1a1a; }
  h1 { font-size: 1.5rem; }
  .msg { border-left: 3px solid #ddd; padding: 0.6rem 1rem; margin: 1rem 0; background: #f8f8f6; }
  .msg.assistant { border-left-color: #d97757; background: #fdf6f0; }
  .msg h3 { margin: 0 0 .5rem 0; font-size: .85rem; color: #888; font-weight: 500; }
  pre { white-space: pre-wrap; word-wrap: break-word; margin: 0; font-family: 'JetBrains Mono', monospace; font-size: 13px; }
  footer { margin-top: 3rem; font-size: 11px; color: #888; text-align: center; }
</style></head>
<body>
  <h1>${escape(title)}</h1>
  ${body}
  <footer>Exported from Cowork - ${new Date().toISOString()}</footer>
</body></html>`;
}

function downloadBlob(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportShareableDialog({ onClose }: ExportShareableDialogProps) {
  const { t } = useTranslation();
  const activeSession = useAppStore((s) => s.sessions.find((sess) => sess.id === s.activeSessionId));
  const messages = useActiveSessionMessages();
  const [busy, setBusy] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const exportHtml = () => {
    if (!activeSession) return;
    const html = renderSessionAsHtml(activeSession.title, messages);
    downloadBlob(html, 'text/html', `${activeSession.title.replace(/[^a-z0-9]/gi, '_')}.html`);
  };

  const openPrintable = () => {
    if (!activeSession) return;
    const html = renderSessionAsHtml(activeSession.title, messages);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    // Open in a new window — user can then press Cmd/Ctrl+P to save as PDF.
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) {
      setError(t('export.popupBlocked', 'Browser blocked the print window.'));
    }
  };

  const createShareLink = async () => {
    if (!activeSession) return;
    setBusy(true);
    setError(null);
    try {
      const api = (window.electronAPI as unknown as { session?: { share?: (id: string) => Promise<{ url: string }> } })?.session?.share;
      if (api) {
        const out = await api(activeSession.id);
        setShareLink(out.url);
      } else {
        setShareLink(`coworkshare://local/${activeSession.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4" role="dialog" aria-modal="true" data-testid="export-shareable-dialog">
      <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-muted">
          <div className="flex items-center gap-2">
            <Download size={16} className="text-accent" />
            <h2 className="text-sm font-semibold">{t('export.title', 'Export & share')}</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover">
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-2">
          <button onClick={exportHtml} disabled={!activeSession} className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-border-subtle hover:bg-surface-hover" data-testid="export-html">
            <FileText size={14} />
            {t('export.html', 'Standalone HTML')}
          </button>
          <button onClick={openPrintable} disabled={!activeSession} className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-border-subtle hover:bg-surface-hover" data-testid="export-pdf">
            <Printer size={14} />
            {t('export.pdf', 'Print as PDF (Cmd/Ctrl+P)')}
          </button>
          <button onClick={createShareLink} disabled={!activeSession || busy} className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-border-subtle hover:bg-surface-hover" data-testid="export-link">
            <Link2 size={14} />
            {busy ? t('export.creating', 'Creating link...') : t('export.shareLink', 'Create share link')}
          </button>
          {shareLink && (
            <div className="mt-3 p-2 bg-surface/40 border border-border-subtle rounded text-xs">
              <span className="text-text-muted">{t('export.linkReady', 'Link ready:')}</span>
              <input
                readOnly
                value={shareLink}
                className="block w-full mt-1 px-2 py-1 bg-background border border-border-subtle rounded font-mono text-[11px]"
                onFocus={(e) => e.currentTarget.select()}
                data-testid="export-link-value"
              />
            </div>
          )}
          {error && <p className="text-[11px] text-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
