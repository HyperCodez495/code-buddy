/**
 * autonomy-queue-model — pure summary of the REAL autonomy daemon board
 * (`autonomy.snapshot` IPC over ~/.codebuddy/fleet): task rows ordered by
 * urgency, agent presence with freshness, and the recent worklog. No IO, no
 * Date.now() — `now` is injected so the summary is deterministic and testable.
 */

export interface SnapshotTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  claimedBy?: string | null;
}

export interface SnapshotWorklogEntry {
  id?: string;
  date?: string;
  agent?: string;
  taskId?: string | null;
  summary?: string;
}

export interface SnapshotPresence {
  host?: string;
  status?: string;
  currentTask?: string | null;
  lastSeen?: string;
}

export interface AutonomySnapshot {
  tasks: SnapshotTask[];
  worklog: SnapshotWorklogEntry[];
  presence: Record<string, SnapshotPresence>;
}

export interface QueueCounts {
  inProgress: number;
  pending: number;
  completed: number;
}

export interface AgentRow {
  name: string;
  currentTask: string | null;
  /** true when lastSeen is within the freshness window (10 min) */
  fresh: boolean;
  lastSeenLabel: string;
}

export interface QueueSummary {
  counts: QueueCounts;
  /** in_progress first, then pending by priority, completed last; capped */
  tasks: SnapshotTask[];
  agents: AgentRow[];
  /** newest first, capped */
  worklog: Array<{ summary: string; agent: string; dateLabel: string }>;
}

const IN_PROGRESS = new Set(['in_progress', 'claimed', 'running']);
const COMPLETED = new Set(['completed', 'done']);
const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const FRESH_WINDOW_MS = 10 * 60 * 1000;

function statusRank(status: string): number {
  if (IN_PROGRESS.has(status)) return 0;
  if (COMPLETED.has(status)) return 2;
  return 1; // pending / todo / anything else = waiting
}

/** "il y a 3 min" / "il y a 2 h" / "il y a 5 j" — relative, French, coarse. */
export function relativeLabel(iso: string | undefined, now: Date): string {
  if (!iso) return '—';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '—';
  const deltaMs = Math.max(0, now.getTime() - then);
  const min = Math.floor(deltaMs / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

export function summarizeAutonomyQueue(
  snapshot: AutonomySnapshot,
  now: Date,
  caps: { tasks?: number; worklog?: number } = {},
): QueueSummary {
  const taskCap = caps.tasks ?? 8;
  const worklogCap = caps.worklog ?? 5;

  const counts: QueueCounts = { inProgress: 0, pending: 0, completed: 0 };
  for (const task of snapshot.tasks) {
    const rank = statusRank(task.status);
    if (rank === 0) counts.inProgress += 1;
    else if (rank === 2) counts.completed += 1;
    else counts.pending += 1;
  }

  const tasks = [...snapshot.tasks]
    .sort((a, b) => {
      const byStatus = statusRank(a.status) - statusRank(b.status);
      if (byStatus !== 0) return byStatus;
      return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
    })
    .slice(0, taskCap);

  const agents: AgentRow[] = Object.entries(snapshot.presence)
    .map(([name, p]) => {
      const seen = p.lastSeen ? Date.parse(p.lastSeen) : NaN;
      return {
        name: p.host ?? name,
        currentTask: p.currentTask ?? null,
        fresh: Number.isFinite(seen) && now.getTime() - seen <= FRESH_WINDOW_MS,
        lastSeenLabel: relativeLabel(p.lastSeen, now),
      };
    })
    .sort((a, b) => Number(b.fresh) - Number(a.fresh) || a.name.localeCompare(b.name));

  const worklog = [...snapshot.worklog]
    .filter((entry) => (entry.summary ?? '').trim().length > 0)
    .sort((a, b) => (Date.parse(b.date ?? '') || 0) - (Date.parse(a.date ?? '') || 0))
    .slice(0, worklogCap)
    .map((entry) => ({
      summary: entry.summary ?? '',
      agent: entry.agent ?? '?',
      dateLabel: relativeLabel(entry.date, now),
    }));

  return { counts, tasks, agents, worklog };
}
