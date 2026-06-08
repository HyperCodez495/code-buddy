/**
 * AutonomyPanel — read-only view of the autonomous fleet's colab queue.
 *
 * Surfaces what `buddy autonomy run` / the always-on daemon are doing: the
 * shared task queue (status + priority + claim + DAG deps), live presence, and
 * the recent worklog. Reads via the `autonomy.snapshot` IPC (FleetColabStore,
 * default ~/.codebuddy/fleet). Mirrors the ReasoningTraceViewer/MemoryPanel shell.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Cpu, RefreshCw, Loader2, CheckCircle2, CircleDot, Ban } from 'lucide-react';

interface ColabTaskView {
  id: string;
  title: string;
  status: string;
  priority: string;
  claimedBy?: string | null;
  dependsOn?: string[];
}
interface WorklogView {
  taskId?: string | null;
  agent?: string;
  summary?: string;
  date?: string;
}
interface PresenceView {
  status?: string;
  currentTask?: string | null;
}
interface Snapshot {
  ok: boolean;
  error?: string;
  dir: string | null;
  tasks: ColabTaskView[];
  worklog: WorklogView[];
  presence: Record<string, PresenceView>;
}

interface AutonomyPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRIORITY_COLOR: Record<string, string> = {
  critical: 'text-error border-error/40',
  high: 'text-warning border-warning/40',
  medium: 'text-text-secondary border-border',
  low: 'text-text-muted border-border-muted',
};

// in_progress first (what's running now), then claimable, then done/blocked.
const STATUS_ORDER: { id: string; label: string; icon: typeof CircleDot }[] = [
  { id: 'in_progress', label: 'In progress', icon: Loader2 },
  { id: 'open', label: 'Queued', icon: CircleDot },
  { id: 'blocked', label: 'Blocked', icon: Ban },
  { id: 'completed', label: 'Completed', icon: CheckCircle2 },
];

export function AutonomyPanel({ isOpen, onClose }: AutonomyPanelProps) {
  const { t } = useTranslation();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const api = window.electronAPI;
      const result = api?.autonomy ? await api.autonomy.snapshot() : null;
      setSnap(result as Snapshot | null);
    } catch (err) {
      setSnap({ ok: false, error: String(err), dir: null, tasks: [], worklog: [], presence: {} });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  if (!isOpen) return null;

  const tasks = snap?.tasks ?? [];
  const presence = Object.entries(snap?.presence ?? {});

  return (
    <div
      className="fixed right-0 top-0 h-full w-[600px] max-w-[95vw] bg-background border-l border-border shadow-2xl z-40 flex flex-col"
      data-testid="autonomy-panel"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-muted flex-shrink-0">
        <Cpu size={16} className="text-accent" />
        <h2 className="text-sm font-semibold text-text-primary">
          {t('autonomy.title', 'Autonomy')}
        </h2>
        <button
          onClick={() => void load()}
          className="ml-auto p-1 text-text-muted hover:text-text-primary"
          title={t('common.refresh', 'Refresh')}
          data-testid="autonomy-refresh"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={onClose}
          className="p-1 text-text-muted hover:text-text-primary"
          aria-label={t('common.close', 'Close')}
          title={t('common.close', 'Close')}
          data-testid="autonomy-panel-close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
        {/* Queue dir + status */}
        <p className="text-[10px] text-text-muted font-mono truncate" title={snap?.dir ?? ''}>
          {snap?.dir ?? t('common.loading', 'Loading…')}
        </p>
        {snap && !snap.ok && (
          <p className="text-[11px] text-error">{snap.error ?? t('autonomy.unavailable', 'Queue unavailable')}</p>
        )}

        {/* Presence */}
        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-1.5">
            {t('autonomy.agents', 'Agents')} ({presence.length})
          </h3>
          {presence.length === 0 && <p className="text-text-muted">{t('autonomy.noAgents', 'No agents present.')}</p>}
          <div className="space-y-1">
            {presence.map(([id, p]) => (
              <div key={id} className="flex items-center gap-2 px-2 py-1 rounded bg-surface/40 border border-border-muted">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${p.status === 'active' ? 'bg-success' : p.status === 'idle' ? 'bg-warning' : 'bg-text-muted'}`}
                />
                <span className="font-mono truncate">{id}</span>
                {p.currentTask && <span className="ml-auto text-text-muted truncate">{p.currentTask}</span>}
              </div>
            ))}
          </div>
        </section>

        {/* Tasks by status */}
        {STATUS_ORDER.map((grp) => {
          const groupTasks = tasks.filter((task) => task.status === grp.id);
          if (groupTasks.length === 0) return null;
          const GroupIcon = grp.icon;
          return (
            <section key={grp.id}>
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-1.5 flex items-center gap-1.5">
                <GroupIcon size={11} className={grp.id === 'in_progress' && loading ? 'animate-spin' : ''} />
                {t(`autonomy.status.${grp.id}`, grp.label)} ({groupTasks.length})
              </h3>
              <div className="space-y-1.5">
                {groupTasks.map((task) => (
                  <div
                    key={task.id}
                    className="p-2.5 rounded-lg bg-surface/40 border border-border-muted"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded border uppercase ${PRIORITY_COLOR[task.priority] ?? PRIORITY_COLOR.medium}`}
                      >
                        {task.priority}
                      </span>
                      <span className="text-text-secondary truncate flex-1">{task.title}</span>
                    </div>
                    {(task.claimedBy || (task.dependsOn && task.dependsOn.length > 0)) && (
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-text-muted">
                        {task.claimedBy && <span className="font-mono truncate">@{task.claimedBy}</span>}
                        {task.dependsOn && task.dependsOn.length > 0 && (
                          <span className="ml-auto">⬑ {task.dependsOn.length} dep{task.dependsOn.length > 1 ? 's' : ''}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        {tasks.length === 0 && snap?.ok && (
          <p className="text-text-muted text-center py-4">{t('autonomy.empty', 'The fleet queue is empty.')}</p>
        )}

        {/* Worklog */}
        {snap && snap.worklog.length > 0 && (
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-1.5">
              {t('autonomy.worklog', 'Recent worklog')}
            </h3>
            <div className="space-y-1">
              {snap.worklog.map((entry, i) => (
                <div key={i} className="px-2 py-1.5 rounded bg-surface/30 border border-border-muted">
                  <div className="flex items-center gap-2 text-[10px] text-text-muted">
                    {entry.agent && <span className="font-mono truncate">{entry.agent}</span>}
                    {entry.taskId && <span className="truncate">{entry.taskId}</span>}
                  </div>
                  {entry.summary && <p className="text-text-secondary mt-0.5 leading-relaxed">{entry.summary}</p>}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
