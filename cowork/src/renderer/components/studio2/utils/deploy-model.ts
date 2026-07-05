export type DeployTargetId = 'surge' | 'netlify' | 'vercel' | 'zip';
export type DeployStatus = 'idle' | 'deploying' | 'success' | 'error';
export type Tone = 'neutral' | 'info' | 'success' | 'danger';
export interface DeployTargetOption { id: DeployTargetId; label: string; description: string; }
export const deployTargets: DeployTargetOption[] = [
  { id: 'surge', label: 'Surge', description: 'Static deploy via surge CLI when installed.' },
  { id: 'netlify', label: 'Netlify', description: 'Static deploy via netlify CLI when installed.' },
  { id: 'vercel', label: 'Vercel', description: 'Static deploy via vercel CLI when installed.' },
  { id: 'zip', label: 'Local zip', description: 'Always available offline artifact.' },
];
export function statusTone(status: DeployStatus): Tone { if (status === 'success') return 'success'; if (status === 'error') return 'danger'; if (status === 'deploying') return 'info'; return 'neutral'; }
