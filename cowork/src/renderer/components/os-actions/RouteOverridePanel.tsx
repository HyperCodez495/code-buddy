import { GitFork, Lock, Zap } from 'lucide-react';

import { Pill } from '../ui/Pill.js';
import { privacyImpact, rankAlternatives, type RouteAlternative } from './utils/route-override-model.js';

export interface RouteOverridePanelProps {
  taskId: string;
  alternatives: RouteAlternative[];
  selectedId?: string;
  onOverride: (taskId: string, alternative: RouteAlternative) => void;
}

export function RouteOverridePanel({ taskId, alternatives, selectedId, onOverride }: RouteOverridePanelProps) {
  const ranked = rankAlternatives(alternatives);

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Routage</div>
          <h3 className="text-base font-semibold text-foreground">Override tâche {taskId}</h3>
        </div>
        <GitFork className="h-5 w-5 text-primary" />
      </div>
      <div className="mt-4 space-y-3">
        {ranked.map((alternative) => (
          <button
            key={alternative.id}
            type="button"
            disabled={!alternative.available}
            onClick={() => onOverride(taskId, alternative)}
            className={`w-full rounded-lg border p-3 text-left transition ${selectedId === alternative.id ? 'border-primary bg-primary/10' : 'border-border bg-background hover:bg-muted'} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-foreground">{alternative.label}</span>
              <Pill tone={alternative.privacyTier === 'high' ? 'danger' : alternative.privacyTier === 'medium' ? 'warning' : 'success'}>{alternative.targetType}</Pill>
            </div>
            <div className="mt-2 grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
              <span className="inline-flex items-center gap-1"><Zap className="h-3 w-3" /> ${alternative.costUsd.toFixed(2)}</span>
              <span>{alternative.latencyMs} ms</span>
              <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" /> {privacyImpact(alternative)}</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
