/**
 * SettingsTunnel — P6.3
 *
 * UI for exposing the embedded Cowork server via a public tunnel
 * (Cloudflared / Tailscale funnel). Surfaces the publicUrl returned by
 * the remote/gateway module and lets the user start/stop the tunnel.
 * Backend may not be fully wired in every build — UI degrades gracefully.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Power, Copy, RefreshCw, AlertCircle } from 'lucide-react';

interface TunnelStatus {
  active: boolean;
  publicUrl?: string;
  provider?: 'cloudflared' | 'tailscale' | 'none';
  startedAt?: number;
}

export function SettingsTunnel() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TunnelStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    const api = (window.electronAPI as unknown as { remote?: { getTunnelStatus?: () => Promise<TunnelStatus> } })?.remote?.getTunnelStatus;
    if (!api) {
      setStatus({ active: false, provider: 'none' });
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const s = await api();
      setStatus(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = async () => {
    const start = (window.electronAPI as unknown as { remote?: { startTunnel?: () => Promise<TunnelStatus>; stopTunnel?: () => Promise<TunnelStatus> } })?.remote;
    if (!start) {
      setError(t('tunnel.notAvailable', 'Tunnel bridge not available in this build.'));
      return;
    }
    setLoading(true);
    try {
      const next = status?.active ? await start.stopTunnel?.() : await start.startTunnel?.();
      if (next) setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!status?.publicUrl) return;
    await navigator.clipboard.writeText(status.publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="p-4 space-y-4 max-w-2xl" data-testid="settings-tunnel">
      <div className="flex items-center gap-2">
        <Globe size={16} className="text-text-muted" />
        <h3 className="text-sm font-semibold">{t('tunnel.title', 'Public tunnel')}</h3>
      </div>

      <p className="text-xs text-text-muted">
        {t(
          'tunnel.intro',
          'Expose the embedded Cowork server on the public internet via Cloudflared or Tailscale funnel. JWT and rate-limiting still apply — never disable them while a tunnel is active.'
        )}
      </p>

      <div className="border border-border-subtle rounded-lg p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-medium">
              {status?.active
                ? t('tunnel.statusActive', 'Tunnel active')
                : t('tunnel.statusInactive', 'Tunnel inactive')}
            </div>
            {status?.provider && (
              <div className="text-[11px] text-text-muted mt-0.5">
                {t('tunnel.provider', 'Provider')}: {status.provider}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={refresh}
              className="p-1.5 rounded-md hover:bg-surface-hover"
              disabled={loading}
              title={t('common.refresh', 'Refresh')}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={toggle}
              disabled={loading}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md ${
                status?.active
                  ? 'bg-error/15 text-error hover:bg-error/25'
                  : 'bg-accent text-background hover:bg-accent-hover'
              } disabled:opacity-40`}
              data-testid="tunnel-toggle"
            >
              <Power size={12} />
              {status?.active ? t('tunnel.stop', 'Stop') : t('tunnel.start', 'Start')}
            </button>
          </div>
        </div>

        {status?.publicUrl && (
          <div>
            <label className="block text-[11px] text-text-secondary mb-1">
              {t('tunnel.publicUrl', 'Public URL')}
            </label>
            <div className="flex items-center gap-1.5">
              <input
                readOnly
                value={status.publicUrl}
                className="flex-1 px-2 py-1 text-xs font-mono rounded bg-surface border border-border-subtle"
                onFocus={(e) => e.currentTarget.select()}
                data-testid="tunnel-public-url"
              />
              <button
                type="button"
                onClick={copy}
                className="px-2 py-1 text-xs rounded hover:bg-surface-hover"
              >
                <Copy size={12} />
              </button>
            </div>
            {copied && <p className="text-[10px] text-success mt-1">{t('common.copied', 'Copied!')}</p>}
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-error/10 border border-error/30 text-error text-xs">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-warning/5 border border-warning/20 rounded-lg p-3">
        <p className="text-[11px] text-text-secondary">
          {t(
            'tunnel.securityNote',
            'Security checklist before enabling: JWT_SECRET set, rate-limit enabled, IP allowlist if possible, and 2FA on the cloud endpoint hosting your tunnel.'
          )}
        </p>
      </div>
    </div>
  );
}
