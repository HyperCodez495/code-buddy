export type PeerRole = 'leaf' | 'worker' | 'reviewer' | 'coordinator';

export interface PeerControlState {
  role: PeerRole;
  capacity: number;
  allowlist: string[];
  paused: boolean;
}

export function normalizeCapacity(capacity: number): number {
  return Math.min(100, Math.max(0, Math.round(capacity)));
}

export function canAssignRole(role: PeerRole, capacity: number): boolean {
  if (role === 'coordinator') return capacity >= 50;
  if (role === 'reviewer') return capacity >= 20;
  return capacity >= 0;
}

export function normalizeAllowlist(allowlist: string[]): string[] {
  return [...new Set(allowlist.map((item) => item.trim()).filter(Boolean))].sort();
}
