/**
 * ActivityFeed — Claude Cowork parity Phase 2 step 18
 *
 * Slide-out panel from the right edge showing cross-project activity
 * (session start/end, subagents, notifications, checkpoints, gui actions).
 * Grouped by day, filterable by project/type.
 *
 * @module renderer/components/ActivityFeed
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  X,
  Loader2,
  Clock,
  FolderKanban,
  Brain,
  Bot,
  Bell,
  Monitor,
  CheckCircle2,
  GitCommit,
  Trash2,
  Network,
  type LucideIcon,
} from 'lucide-react';
import { useAppStore } from '../store';
import { formatAppDate, formatAppTime } from '../utils/i18n-format';

interface ActivityEntry {
  id: number;
  type: string;
  title: string;
  description?: string;
  sessionId?: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

interface ActivityFeedProps {
  open: boolean;
  onClose: () => void;
}

const TYPE_ICONS: Record<string, LucideIcon> = {
  'session.start': Clock,
  'session.end': Clock,
  'subagent.spawned': Bot,
  'subagent.completed': Bot,
  notification: Bell,
  'checkpoint.created': GitCommit,
  'gui.action': Monitor,
  'task.complete': CheckCircle2,
  'project.created': FolderKanban,
  'project.deleted': FolderKanban,
  'workflow.run': Activity,
  'memory.added': Brain,
  'fleet.dispatch': Network,
  'fleet.saga.completed': Network,
  'fleet.saga.failed': Network,
};

function groupByDay(entries: ActivityEntry[]): Array<[string, ActivityEntry[]]> {
  const groups = new Map<string, ActivityEntry[]>();
  for (const entry of entries) {
    const key = formatAppDate(entry.timestamp, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }
  return Array.from(groups.entries());
}

export const ActivityFeed: React.FC<ActivityFeedProps> = ({ open, onClose }) => {
  const { i18n, t } = useTranslation();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setActiveProjectId = useAppStore((s) => s.setActiveProjectId);
  const setShowFleetCommandCenter = useAppStore((s) => s.setShowFleetCommandCenter);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const api = window.electronAPI;
      if (!api?.activity?.recent) {
        setEntries([]);
        return;
      }
      const result = await api.activity.recent(100);
      setEntries(result);
    } catch (err) {
      console.error('[ActivityFeed] load failed:', err);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const grouped = useMemo(() => groupByDay(entries), [entries, i18n.resolvedLanguage]);

  const handleClick = (entry: ActivityEntry) => {
    if (entry.projectId) setActiveProjectId(entry.projectId);
    if (entry.sessionId) setActiveSession(entry.sessionId);
    if (isFleetActivity(entry)) setShowFleetCommandCenter(true);
    onClose();
  };

  const handleClear = async () => {
    if (!confirm(t('activity.clearConfirm'))) return;
    const api = window.electronAPI;
    if (!api?.activity?.clear) return;
    await api.activity.clear();
    await load();
  };

  if (!open) return null;

  return (
    <div className="fixed right-0 top-0 bottom-0 w-[400px] max-w-[90vw] bg-background border-l border-border shadow-elevated z-40 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-muted shrink-0">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-accent" />
          <span className="text-xs font-semibold text-text-primary">
            {t('activity.title')}
          </span>
          <span className="text-[10px] text-text-muted">
            {t('activity.count', { count: entries.length })}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleClear}
            className="p-1.5 text-text-muted hover:text-error transition-colors"
            title={t('activity.clear')}
          >
            <Trash2 size={12} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
            title={t('common.close')}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-text-muted">
            <Loader2 size={14} className="animate-spin" />
            {t('common.loading')}
          </div>
        )}

        {!loading && entries.length === 0 && (
          <div className="text-center py-12">
            <Activity size={28} className="mx-auto text-text-muted opacity-30 mb-2" />
            <div className="text-xs text-text-muted">{t('activity.empty')}</div>
          </div>
        )}

        {!loading &&
          grouped.map(([day, dayEntries]) => (
            <div key={day} className="border-b border-border-muted last:border-b-0">
              <div className="px-4 py-1.5 bg-surface/50 sticky top-0">
                <span className="text-[10px] uppercase tracking-wide font-semibold text-text-muted">
                  {day}
                </span>
              </div>
              {dayEntries.map((entry) => {
                const Icon = TYPE_ICONS[entry.type] ?? Activity;
                const time = formatAppTime(entry.timestamp);
                return (
                  <button
                    key={entry.id}
                    onClick={() => handleClick(entry)}
                    className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-surface-hover transition-colors text-left border-l-2 border-transparent hover:border-accent"
                  >
                    <Icon size={12} className="text-text-muted shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-text-primary truncate">
                        {entry.title}
                      </div>
                      {entry.description && (
                        <div className="text-[11px] text-text-muted truncate mt-0.5">
                          {entry.description}
                        </div>
                      )}
                      {isFleetActivity(entry) && (
                        <FleetActivityMeta metadata={entry.metadata} />
                      )}
                    </div>
                    <span className="text-[10px] text-text-muted shrink-0">{time}</span>
                  </button>
                );
              })}
            </div>
          ))}
      </div>
    </div>
  );
};

const FleetActivityMeta: React.FC<{ metadata?: Record<string, unknown> }> = ({ metadata }) => {
  if (!metadata) return null;
  const chips = buildFleetActivityChips(metadata);
  if (chips.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded border border-border-muted bg-surface px-1.5 py-0.5 text-[10px] text-text-muted"
        >
          {chip}
        </span>
      ))}
    </div>
  );
};

function isFleetActivity(entry: ActivityEntry): boolean {
  return entry.type === 'fleet.dispatch' || entry.type.startsWith('fleet.saga.');
}

function buildFleetActivityChips(metadata: Record<string, unknown>): string[] {
  const chips: string[] = [];
  if (typeof metadata.sagaId === 'string') chips.push(`saga ${shortId(metadata.sagaId)}`);
  if (typeof metadata.privacyTag === 'string') chips.push(metadata.privacyTag);
  if (typeof metadata.parallelism === 'number' && metadata.parallelism > 1) {
    chips.push(`parallel ${metadata.parallelism}`);
  }
  if (typeof metadata.peerCount === 'number') chips.push(`${metadata.peerCount} peers`);
  if (
    typeof metadata.completedSteps === 'number' &&
    typeof metadata.totalSteps === 'number'
  ) {
    chips.push(`${metadata.completedSteps}/${metadata.totalSteps} done`);
  }
  if (typeof metadata.failedSteps === 'number' && metadata.failedSteps > 0) {
    chips.push(`${metadata.failedSteps} failed`);
  }
  if (typeof metadata.durationMs === 'number') {
    chips.push(formatDuration(metadata.durationMs));
  }
  return chips;
}

function shortId(id: string): string {
  if (id.length <= 10) return id;
  return id.slice(0, 8);
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '0s';
  if (durationMs < 60_000) return `${Math.max(1, Math.round(durationMs / 1000))}s`;
  if (durationMs < 3_600_000) return `${Math.round(durationMs / 60_000)}m`;
  return `${Math.round(durationMs / 3_600_000)}h`;
}
