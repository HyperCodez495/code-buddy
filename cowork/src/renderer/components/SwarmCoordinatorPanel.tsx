/**
 * SwarmCoordinatorPanel — P3.2
 *
 * Team-lead style overview combining the existing TeamPanel data with a
 * /swarm launcher. Reuses team-bridge under the hood.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Users, Send } from 'lucide-react';
import { useAppStore } from '../store';

interface SwarmCoordinatorPanelProps {
  onClose: () => void;
}

export function SwarmCoordinatorPanel({ onClose }: SwarmCoordinatorPanelProps) {
  const { t } = useTranslation();
  const teamSnapshot = useAppStore((s) => s.team);
  const teamMembers = useAppStore((s) => s.teamMembers);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const [task, setTask] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const launchSwarm = async () => {
    if (!task.trim()) return;
    const api = window.electronAPI?.command?.execute;
    if (!api) {
      setError(t('swarm.notAvailable', '/swarm not available.'));
      return;
    }
    try {
      const result = await api('swarm', [task.trim()], activeSessionId ?? undefined);
      if (result?.error) setError(result.error);
      else onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const members = Object.values(teamMembers ?? {});
  // teamSnapshot is referenced just to ensure live update when its members change.
  void teamSnapshot;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4" role="dialog" aria-modal="true" data-testid="swarm-coordinator-panel">
      <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-muted">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-accent" />
            <h2 className="text-sm font-semibold">{t('swarm.title', 'Swarm coordinator')}</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover">
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <p className="text-xs text-text-muted">
            {t(
              'swarm.intro',
              'Dispatch a goal across all currently active team members. Like a team-lead handing out work.'
            )}
          </p>
          <div className="border border-border-subtle rounded-lg p-3">
            <h3 className="text-xs font-medium mb-2">{t('swarm.activeMembers', 'Active members')} ({members.length})</h3>
            {members.length === 0 ? (
              <p className="text-[11px] italic text-text-muted">{t('swarm.noMembers', 'No team active. Start one from the Team panel.')}</p>
            ) : (
              <ul className="space-y-1">
                {members.map((m: { id: string; nickname?: string; role?: string }) => (
                  <li key={m.id} className="text-xs flex items-center justify-between">
                    <span className="font-medium">{m.nickname ?? m.id}</span>
                    <span className="text-[10px] text-text-muted uppercase">{m.role ?? ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder={t('swarm.placeholder', 'Describe the swarm-wide task…')}
            rows={3}
            className="w-full px-3 py-2 text-sm rounded-md bg-surface border border-border-subtle focus:outline-none focus:border-accent"
            data-testid="swarm-task"
          />
          {error && <p className="text-[11px] text-error">{error}</p>}
          <button
            type="button"
            onClick={launchSwarm}
            disabled={!task.trim()}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-accent text-background hover:bg-accent-hover disabled:opacity-40"
            data-testid="swarm-launch"
          >
            <Send size={12} />
            {t('swarm.dispatch', 'Dispatch')}
          </button>
        </div>
      </div>
    </div>
  );
}
