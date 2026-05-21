/**
 * FleetHealthDashboard — P5.3
 *
 * Per-peer health view: status, last-seen, capability matrix, recent
 * dispatch history. Reads from the fleetPeers store (already populated
 * by fleet-bridge).
 */
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Radio, Wifi, WifiOff, Globe } from 'lucide-react';
import { useAppStore } from '../store';
import type { FleetPeer } from '../types';

interface FleetHealthDashboardProps {
  onClose: () => void;
}

const STATUS_COLOR: Record<string, string> = {
  connected: 'text-success',
  authenticated: 'text-success',
  connecting: 'text-warning',
  error: 'text-error',
  disconnected: 'text-text-muted',
};

function formatRelative(ts: number | undefined): string {
  if (!ts) return '—';
  const dt = Date.now() - ts;
  if (dt < 60_000) return 'just now';
  if (dt < 3_600_000) return `${Math.floor(dt / 60_000)}m ago`;
  if (dt < 86_400_000) return `${Math.floor(dt / 3_600_000)}h ago`;
  return `${Math.floor(dt / 86_400_000)}d ago`;
}

export function FleetHealthDashboard({ onClose }: FleetHealthDashboardProps) {
  const { t } = useTranslation();
  const fleetPeers = useAppStore((s) => s.fleetPeers);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const peers = useMemo(() => Object.values(fleetPeers) as FleetPeer[], [fleetPeers]);
  const connected = peers.filter((p) => p.status === 'connected' || p.status === 'authenticated').length;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4" role="dialog" aria-modal="true" data-testid="fleet-health-dashboard">
      <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-muted">
          <div className="flex items-center gap-2">
            <Radio size={16} className="text-accent" />
            <h2 className="text-sm font-semibold">{t('fleetHealth.title', 'Fleet health')}</h2>
            <span className="text-[11px] text-text-muted">
              {connected}/{peers.length} {t('fleetHealth.online', 'online')}
            </span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover">
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {peers.length === 0 ? (
            <p className="text-xs italic text-text-muted text-center py-12">
              {t('fleetHealth.empty', 'No peers registered. Add one from Settings → Remote.')}
            </p>
          ) : (
            peers.map((peer) => {
              const isOnline = peer.status === 'connected' || peer.status === 'authenticated';
              return (
                <div
                  key={peer.id}
                  className="border border-border-subtle rounded-lg p-3 flex items-start gap-3"
                >
                  {isOnline ? (
                    <Wifi className={`w-4 h-4 mt-0.5 shrink-0 ${STATUS_COLOR[peer.status]}`} />
                  ) : (
                    <WifiOff className={`w-4 h-4 mt-0.5 shrink-0 ${STATUS_COLOR[peer.status] ?? 'text-text-muted'}`} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{peer.label ?? peer.id}</span>
                      <span className={`text-[10px] uppercase ${STATUS_COLOR[peer.status]}`}>{peer.status}</span>
                    </div>
                    {peer.url && (
                      <p className="text-[11px] text-text-muted truncate flex items-center gap-1 mt-0.5">
                        <Globe size={10} />
                        {peer.url}
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-[10px] text-text-muted mt-1">
                      <span>{t('fleetHealth.lastSeen', 'last seen')}: {formatRelative(peer.lastSeenAt)}</span>
                      {peer.capability?.models && peer.capability.models.length > 0 && (
                        <span>{peer.capability.models.length} {t('fleetHealth.models', 'models')}</span>
                      )}
                      {Array.isArray(peer.chatSessions) && (
                        <span>{peer.chatSessions.length} {t('fleetHealth.sessions', 'sessions')}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
