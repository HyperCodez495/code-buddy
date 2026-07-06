/**
 * AutonomyQueueBoard — the autonomy daemon's task board, live.
 *
 * Renders the summarized `autonomy.snapshot` (see autonomy-queue-model.ts):
 * status counts, the task queue, agent presence with freshness, recent
 * worklog. Purely presentational — the caller owns the IPC.
 */
import { Bot, CircleCheck, CircleDashed, LoaderCircle } from 'lucide-react';

import type { QueueSummary } from './autonomy-queue-model.js';

function statusIcon(status: string) {
  if (status === 'in_progress' || status === 'claimed' || status === 'running') {
    return <LoaderCircle className="h-3.5 w-3.5 text-warning" aria-hidden="true" />;
  }
  if (status === 'completed' || status === 'done') {
    return <CircleCheck className="h-3.5 w-3.5 text-success" aria-hidden="true" />;
  }
  return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />;
}

export function AutonomyQueueBoard({ summary }: { summary: QueueSummary }) {
  const { counts, tasks, agents, worklog } = summary;

  return (
    <section className="rounded-xl border border-border bg-surface p-4" data-testid="autonomy-queue-board">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">File du daemon d'autonomie</h2>
          <p className="text-xs text-muted-foreground">~/.codebuddy/fleet — tâches, agents, journal</p>
        </div>
        <div className="flex items-center gap-2 text-xs tabular-nums">
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-warning">{counts.inProgress} en cours</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{counts.pending} en attente</span>
          <span className="rounded-full bg-success/15 px-2 py-0.5 text-success">{counts.completed} terminées</span>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Tâches</h3>
          {tasks.length === 0 ? (
            <p className="text-xs text-muted-foreground">File vide — le daemon attend du travail.</p>
          ) : (
            <ul className="space-y-1.5">
              {tasks.map((task) => (
                <li key={task.id} className="flex items-center gap-2 text-xs">
                  {statusIcon(task.status)}
                  <span className="min-w-0 flex-1 truncate text-foreground">{task.title}</span>
                  <span className="shrink-0 text-muted-foreground">{task.priority}</span>
                  {task.claimedBy ? <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{task.claimedBy}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Agents présents</h3>
            {agents.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucun agent ne s'est annoncé.</p>
            ) : (
              <ul className="space-y-1.5">
                {agents.map((agent) => (
                  <li key={agent.name} className="flex items-center gap-2 text-xs">
                    <Bot className={`h-3.5 w-3.5 ${agent.fresh ? 'text-success' : 'text-muted-foreground'}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-foreground">{agent.name}</span>
                    {agent.currentTask ? <span className="shrink-0 truncate text-muted-foreground">{agent.currentTask}</span> : null}
                    <span className="shrink-0 tabular-nums text-muted-foreground">{agent.lastSeenLabel}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Journal récent</h3>
            {worklog.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucune entrée de journal.</p>
            ) : (
              <ul className="space-y-1.5">
                {worklog.map((entry, i) => (
                  <li key={i} className="text-xs text-muted-foreground">
                    <span className="text-foreground">{entry.agent}</span> — {entry.summary}{' '}
                    <span className="tabular-nums">({entry.dateLabel})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
