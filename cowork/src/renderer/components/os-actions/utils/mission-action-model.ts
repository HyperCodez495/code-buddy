export type MissionStatus = 'queued' | 'running' | 'paused' | 'failed' | 'completed' | 'cancelled';
export type MissionAction = 'pause' | 'resume' | 'cancel' | 'branch';

const ACTIONS_BY_STATUS: Record<MissionStatus, MissionAction[]> = {
  queued: ['cancel'],
  running: ['pause', 'cancel', 'branch'],
  paused: ['resume', 'cancel', 'branch'],
  failed: ['branch'],
  completed: ['branch'],
  cancelled: [],
};

export function availableActions(status: MissionStatus): MissionAction[] {
  return [...(ACTIONS_BY_STATUS[status] ?? [])];
}

export function requiresConfirmation(action: MissionAction): boolean {
  return action === 'cancel' || action === 'branch';
}
