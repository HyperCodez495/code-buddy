import { PauseCircle, PlayCircle, ServerCog } from 'lucide-react';

import { Pill } from '../ui/Pill.js';
import { canAssignRole, normalizeAllowlist, normalizeCapacity, type PeerControlState, type PeerRole } from './utils/peer-control-model.js';

export interface PeerControlCardProps {
  peerId: string;
  name: string;
  state: PeerControlState;
  onRoleChange: (peerId: string, role: PeerRole) => void;
  onCapacityChange: (peerId: string, capacity: number) => void;
  onAllowlistChange: (peerId: string, allowlist: string[]) => void;
  onPause: (peerId: string) => void;
  onResume: (peerId: string) => void;
}

const roles: PeerRole[] = ['leaf', 'worker', 'reviewer', 'coordinator'];

export function PeerControlCard({ peerId, name, state, onRoleChange, onCapacityChange, onAllowlistChange, onPause, onResume }: PeerControlCardProps) {
  const capacity = normalizeCapacity(state.capacity);
  const allowlist = normalizeAllowlist(state.allowlist);

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><ServerCog className="h-5 w-5 text-primary" /><h3 className="font-semibold text-foreground">{name}</h3></div>
        <Pill tone={state.paused ? 'warning' : 'success'}>{state.paused ? 'pause' : 'actif'}</Pill>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm text-muted-foreground">Rôle
          <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground" value={state.role} onChange={(event) => onRoleChange(peerId, event.target.value as PeerRole)}>
            {roles.map((role) => <option key={role} value={role} disabled={!canAssignRole(role, capacity)}>{role}</option>)}
          </select>
        </label>
        <label className="text-sm text-muted-foreground">Capacité
          <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground" type="number" min={0} max={100} value={capacity} onChange={(event) => onCapacityChange(peerId, normalizeCapacity(Number(event.target.value)))} />
        </label>
      </div>
      <label className="mt-3 block text-sm text-muted-foreground">Allowlist
        <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground" value={allowlist.join(', ')} onChange={(event) => onAllowlistChange(peerId, normalizeAllowlist(event.target.value.split(',')))} />
      </label>
      <button type="button" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm" onClick={() => state.paused ? onResume(peerId) : onPause(peerId)}>
        {state.paused ? <PlayCircle className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
        {state.paused ? 'Reprendre pair' : 'Mettre en pause'}
      </button>
    </section>
  );
}
