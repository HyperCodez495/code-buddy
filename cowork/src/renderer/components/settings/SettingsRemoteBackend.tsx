/**
 * SettingsRemoteBackend (Phase B3) — connect this desktop Cowork to a REMOTE
 * Code Buddy backend for the chat/session core.
 *
 * When connected, the main process proxies the core `session.*` events over
 * the remote `/desktop` WebSocket and repipes ServerEvents back. Management
 * surfaces (config, MCP, skills, fleet) remain LOCAL — surfaced as a notice.
 *
 * The token lives in the main process only; the renderer never reads it back
 * (getConfig returns `hasToken` instead of the token itself).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Info, Loader2, Network } from 'lucide-react';
import { useAppStore } from '../../store';

type ConnStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export function SettingsRemoteBackend() {
  const { t } = useTranslation();
  const setRemoteBackend = useAppStore((s) => s.setRemoteBackend);

  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [hasStoredToken, setHasStoredToken] = useState(false);
  const [status, setStatus] = useState<ConnStatus>('disconnected');
  const [host, setHost] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const applyStatus = useCallback(
    (next: { status: ConnStatus; host?: string; error?: string }) => {
      setStatus(next.status);
      setHost(next.host ?? null);
      if (next.status === 'error' && next.error) {
        setError(next.error);
      } else if (next.status === 'connected') {
        setError(null);
      }
      setRemoteBackend({
        connected: next.status === 'connected',
        host: next.status === 'connected' ? (next.host ?? null) : null,
      });
    },
    [setRemoteBackend]
  );

  // Initial load: persisted url + live status + subscribe to status pushes.
  useEffect(() => {
    const api = window.electronAPI?.remoteBackend;
    if (!api) return;
    let cancelled = false;

    void (async () => {
      try {
        const cfg = await api.getConfig();
        if (cancelled) return;
        setUrl(cfg.url);
        setHasStoredToken(cfg.hasToken);
      } catch {
        /* ignore */
      }
      try {
        const s = await api.status();
        if (!cancelled) applyStatus(s);
      } catch {
        /* ignore */
      }
    })();

    const unsubscribe = api.onStatus((s) => {
      if (!cancelled) applyStatus(s);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [applyStatus]);

  const handleConnect = async () => {
    const api = window.electronAPI?.remoteBackend;
    if (!api || busy) return;
    setBusy(true);
    setError(null);
    setStatus('connecting');
    try {
      const result = await api.connect(url, token);
      if (!result.success) {
        setStatus('error');
        setError(result.error ?? t('remoteBackend.errorGeneric', 'Connection failed'));
      } else {
        // Token accepted and persisted; clear the local input but mark stored.
        setToken('');
        setHasStoredToken(true);
      }
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    const api = window.electronAPI?.remoteBackend;
    if (!api || busy) return;
    setBusy(true);
    try {
      await api.disconnect();
      setStatus('disconnected');
      setHost(null);
      setRemoteBackend({ connected: false, host: null });
    } finally {
      setBusy(false);
    }
  };

  const isConnected = status === 'connected';
  const canConnect = url.trim().length > 0 && (token.trim().length > 0 || hasStoredToken);

  const statusColor =
    status === 'connected'
      ? 'text-success'
      : status === 'error'
        ? 'text-error'
        : status === 'connecting'
          ? 'text-warning'
          : 'text-text-muted';

  const statusLabel = t(`remoteBackend.status.${status}`, status);

  return (
    <div className="p-4 space-y-4 max-w-2xl">
      <div className="flex items-center gap-2">
        <Network size={16} className="text-text-muted" />
        <h3 className="text-sm font-semibold text-text-primary">
          {t('remoteBackend.title', 'Remote backend')}
        </h3>
      </div>

      <p className="text-xs text-text-muted">
        {t(
          'remoteBackend.intro',
          'Connect this desktop to a remote Code Buddy backend for chat and sessions. The connection runs in the main process and uses the backend’s /desktop WebSocket endpoint.'
        )}
      </p>

      {/* Live status */}
      <div className="p-3 rounded border border-border-muted bg-surface/40 flex items-start gap-2 text-xs">
        {status === 'connecting' ? (
          <Loader2 size={14} className="text-warning mt-0.5 animate-spin" />
        ) : (
          <CheckCircle2 size={14} className={`${statusColor} mt-0.5`} />
        )}
        <div className="flex-1">
          <div className="font-medium text-text-primary">
            {t('remoteBackend.statusLabel', 'Status:')}{' '}
            <span className={`font-mono ${statusColor}`}>{statusLabel}</span>
          </div>
          {isConnected && host && (
            <div className="text-text-muted mt-0.5">
              {t('remoteBackend.connectedTo', 'Connected to {{host}}', { host })}
            </div>
          )}
        </div>
      </div>

      {/* URL */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-text-primary" htmlFor="remote-backend-url">
          {t('remoteBackend.urlLabel', 'Backend URL')}
        </label>
        <input
          id="remote-backend-url"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={isConnected || busy}
          placeholder="ws://192.168.1.10:3001"
          className="w-full px-3 py-1.5 text-sm rounded border border-border-muted bg-background text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50"
        />
        <p className="text-[11px] text-text-muted">
          {t(
            'remoteBackend.urlHint',
            'http(s):// is accepted and rewritten to ws(s)://. The /desktop path is added automatically.'
          )}
        </p>
      </div>

      {/* Token */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-text-primary" htmlFor="remote-backend-token">
          {t('remoteBackend.tokenLabel', 'JWT token')}
        </label>
        <input
          id="remote-backend-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          disabled={isConnected || busy}
          placeholder={
            hasStoredToken
              ? t('remoteBackend.tokenStored', 'Stored — leave blank to reuse')
              : t('remoteBackend.tokenPlaceholder', 'Paste the backend JWT')
          }
          className="w-full px-3 py-1.5 text-sm rounded border border-border-muted bg-background text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50"
        />
      </div>

      {/* Local-management notice */}
      <div className="p-2 rounded bg-accent/10 border border-accent/30 text-text-secondary text-[11px] flex gap-2 items-start">
        <Info size={12} className="mt-0.5 shrink-0 text-accent" />
        <div>
          {t(
            'remoteBackend.localNotice',
            'While a remote backend is connected, only chat and sessions run remotely. Management surfaces (config, MCP, skills, fleet) stay local to this machine.'
          )}
        </div>
      </div>

      {error && (
        <div className="p-2 rounded bg-error/10 border border-error/30 text-error text-xs flex gap-2 items-start">
          <AlertCircle size={12} className="mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {isConnected ? (
          <button
            type="button"
            onClick={() => void handleDisconnect()}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded border border-border-muted text-text-primary hover:bg-surface/60 disabled:opacity-50 transition-colors"
            data-testid="remote-backend-disconnect"
          >
            {t('remoteBackend.disconnect', 'Disconnect')}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={!canConnect || busy}
            className="px-3 py-1.5 text-xs rounded bg-accent text-background hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            data-testid="remote-backend-connect"
          >
            {busy
              ? t('remoteBackend.connecting', 'Connecting…')
              : t('remoteBackend.connect', 'Connect')}
          </button>
        )}
      </div>
    </div>
  );
}
