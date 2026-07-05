import { GitBranch, Pause, Play, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Pill } from '../ui/Pill.js';
import { availableActions, requiresConfirmation, type MissionAction, type MissionStatus } from './utils/mission-action-model.js';

export interface MissionActionsMission {
  id: string;
  title: string;
  status: MissionStatus;
}

export interface MissionActionsBarProps {
  mission: MissionActionsMission;
  onPause: (mission: MissionActionsMission) => void;
  onResume: (mission: MissionActionsMission) => void;
  onCancel: (mission: MissionActionsMission) => void;
  onBranch: (mission: MissionActionsMission) => void;
}

const actionMeta: Record<MissionAction, { label: string; icon: typeof Pause; tone: string }> = {
  pause: { label: 'Pause', icon: Pause, tone: 'border-border bg-muted text-foreground' },
  resume: { label: 'Reprendre', icon: Play, tone: 'border-border bg-primary text-primary-foreground' },
  cancel: { label: 'Annuler', icon: XCircle, tone: 'border-red-500/40 bg-muted text-red-500' },
  branch: { label: 'Rebrancher', icon: GitBranch, tone: 'border-border bg-background text-foreground' },
};

function statusTone(status: MissionStatus) {
  if (status === 'failed' || status === 'cancelled') return 'danger' as const;
  if (status === 'paused' || status === 'queued') return 'warning' as const;
  if (status === 'completed') return 'success' as const;
  return 'default' as const;
}

export function MissionActionsBar({ mission, onPause, onResume, onCancel, onBranch }: MissionActionsBarProps) {
  const [pending, setPending] = useState<MissionAction | null>(null);
  const actions = useMemo(() => availableActions(mission.status), [mission.status]);

  const run = (action: MissionAction) => {
    if (requiresConfirmation(action) && pending !== action) {
      setPending(action);
      return;
    }
    setPending(null);
    if (action === 'pause') onPause(mission);
    if (action === 'resume') onResume(mission);
    if (action === 'cancel') onCancel(mission);
    if (action === 'branch') onBranch(mission);
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Mission</div>
          <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-foreground">
            {mission.title}
            <Pill tone={statusTone(mission.status)}>{mission.status}</Pill>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => {
            const meta = actionMeta[action];
            const Icon = meta.icon;
            const confirmed = pending === action;
            return (
              <button
                key={action}
                type="button"
                onClick={() => run(action)}
                className={'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition hover:bg-muted ' + meta.tone}
              >
                <Icon className="h-4 w-4" />
                {confirmed ? 'Confirmer ' + meta.label.toLowerCase() : meta.label}
              </button>
            );
          })}
        </div>
      </div>
      {pending && <p className="mt-2 text-xs text-muted-foreground">Confirmation requise pour {actionMeta[pending].label.toLowerCase()}.</p>}
    </div>
  );
}
