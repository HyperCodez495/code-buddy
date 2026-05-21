/**
 * DiagnosticsPanel — P3.4 (consolidates vulns/secrets/licenses launchers)
 *
 * Single panel exposing three security scans through the core slash commands:
 *   /vulns         → `scan_vulnerabilities`
 *   /secrets-scan  → `scan_secrets`
 *   /licenses      → `scan_licenses`
 *
 * Invokes them via the existing `command.execute` bridge; the agent posts
 * the report into the active session, so the user sees results inline.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  ShieldAlert,
  KeyRound,
  FileBadge,
  Play,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useAppStore } from '../store';

interface DiagnosticsPanelProps {
  onClose: () => void;
}

type ScanKind = 'vulns' | 'secrets-scan' | 'licenses';

const SCANS: { kind: ScanKind; titleKey: string; titleFallback: string; descKey: string; descFallback: string; icon: typeof ShieldAlert }[] = [
  {
    kind: 'vulns',
    titleKey: 'diagnostics.vulnsTitle',
    titleFallback: 'Vulnerability scan',
    descKey: 'diagnostics.vulnsDesc',
    descFallback: 'Run npm/pip/cargo/go audit and report CVEs.',
    icon: ShieldAlert,
  },
  {
    kind: 'secrets-scan',
    titleKey: 'diagnostics.secretsTitle',
    titleFallback: 'Secrets scan',
    descKey: 'diagnostics.secretsDesc',
    descFallback: 'Find AWS keys, tokens, JWTs, private keys, and more in the workspace.',
    icon: KeyRound,
  },
  {
    kind: 'licenses',
    titleKey: 'diagnostics.licensesTitle',
    titleFallback: 'License compliance',
    descKey: 'diagnostics.licensesDesc',
    descFallback: 'Classify dependency licenses via SPDX and flag incompatibilities.',
    icon: FileBadge,
  },
];

export function DiagnosticsPanel({ onClose }: DiagnosticsPanelProps) {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const [running, setRunning] = useState<ScanKind | null>(null);
  const [lastResult, setLastResult] = useState<{ kind: ScanKind; ok: boolean; message?: string } | null>(
    null
  );

  const runScan = async (kind: ScanKind) => {
    setRunning(kind);
    setLastResult(null);
    const api = window.electronAPI?.command?.execute;
    if (!api) {
      setLastResult({ kind, ok: false, message: t('diagnostics.notAvailable', 'Command bridge not available.') });
      setRunning(null);
      return;
    }
    try {
      const result = await api(kind, [], activeSessionId ?? undefined);
      if (result?.error) {
        setLastResult({ kind, ok: false, message: result.error });
      } else {
        setLastResult({
          kind,
          ok: true,
          message: result?.message ?? t('diagnostics.scanQueued', 'Scan running — see results in the chat.'),
        });
      }
    } catch (err) {
      setLastResult({
        kind,
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4"
      data-testid="diagnostics-panel"
    >
      <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-muted">
          <div className="flex items-center gap-2">
            <ShieldAlert size={16} className="text-accent" />
            <h2 className="text-sm font-semibold">
              {t('diagnostics.title', 'Security diagnostics')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover"
          >
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {SCANS.map((scan) => {
            const Icon = scan.icon;
            const isRunning = running === scan.kind;
            const isLast = lastResult?.kind === scan.kind;
            return (
              <div
                key={scan.kind}
                className="border border-border-subtle rounded-lg p-3 flex items-start gap-3"
              >
                <Icon className="w-5 h-5 text-text-muted shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium">{t(scan.titleKey, scan.titleFallback)}</h3>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    {t(scan.descKey, scan.descFallback)}
                  </p>
                  {isLast && lastResult && (
                    <div
                      className={`mt-2 flex items-start gap-1.5 text-[11px] px-2 py-1 rounded ${
                        lastResult.ok
                          ? 'bg-success/10 text-success'
                          : 'bg-error/10 text-error'
                      }`}
                    >
                      {!lastResult.ok && <AlertCircle size={12} className="shrink-0 mt-0.5" />}
                      <span>{lastResult.message}</span>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => runScan(scan.kind)}
                  disabled={isRunning || !activeSessionId}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md bg-accent text-background disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent-hover shrink-0"
                  data-testid={`diagnostics-scan-${scan.kind}`}
                >
                  {isRunning ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      {t('diagnostics.running', 'Running')}
                    </>
                  ) : (
                    <>
                      <Play size={12} />
                      {t('diagnostics.scan', 'Scan')}
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t border-border-muted bg-surface/30">
          <p className="text-[11px] text-text-muted">
            {t(
              'diagnostics.hint',
              'Results post into the active conversation. Open the chat to interact with each finding.'
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
