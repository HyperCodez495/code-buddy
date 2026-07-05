export type AutonomyPosture = 'plan' | 'dontAsk' | 'bypass';

export interface AutonomyPanelData {
  posture: AutonomyPosture;
  running: number;
  queued: number;
  costUsd: number;
  capUsd: number;
  turns: number;
  maxTurns: number;
}

export type AutonomyTone = 'default' | 'success' | 'warning' | 'danger' | 'info';

export interface AutonomyMetric {
  label: string;
  value: string;
  hint: string;
  tone: AutonomyTone;
}

export interface AutonomyGauge {
  label: string;
  value: string;
  percent: number;
  tone: 'success' | 'warning' | 'danger';
}

export interface AutonomySummary {
  postureLabel: string;
  postureTone: AutonomyTone;
  metrics: AutonomyMetric[];
  gauges: AutonomyGauge[];
  isOverCap: boolean;
}

const POSTURE_LABELS: Record<AutonomyPosture, string> = {
  plan: 'Plan contrôlé',
  dontAsk: 'Autonomie guidée',
  bypass: 'Bypass complet',
};

export function clampPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return 'bash.00';
  return '$' + value.toFixed(2);
}

export function toneForPercent(percent: number): 'success' | 'warning' | 'danger' {
  if (percent >= 90) return 'danger';
  if (percent >= 70) return 'warning';
  return 'success';
}

export function summarizeAutonomy(data: AutonomyPanelData): AutonomySummary {
  const costPercent = clampPercent(data.costUsd, data.capUsd);
  const turnsPercent = clampPercent(data.turns, data.maxTurns);

  return {
    postureLabel: POSTURE_LABELS[data.posture],
    postureTone: data.posture === 'bypass' ? 'danger' : data.posture === 'dontAsk' ? 'warning' : 'info',
    metrics: [
      { label: 'En cours', value: String(Math.max(0, data.running)), hint: 'agents actifs', tone: data.running > 0 ? 'success' : 'default' },
      { label: 'File', value: String(Math.max(0, data.queued)), hint: 'missions en attente', tone: data.queued > 0 ? 'warning' : 'default' },
      { label: 'Budget', value: formatUsd(data.costUsd), hint: 'plafond ' + formatUsd(data.capUsd), tone: toneForPercent(costPercent) },
    ],
    gauges: [
      { label: 'Coût', value: formatUsd(data.costUsd) + ' / ' + formatUsd(data.capUsd), percent: costPercent, tone: toneForPercent(costPercent) },
      { label: 'Tours', value: String(Math.max(0, data.turns)) + ' / ' + String(Math.max(0, data.maxTurns)), percent: turnsPercent, tone: toneForPercent(turnsPercent) },
    ],
    isOverCap: data.capUsd > 0 && data.costUsd >= data.capUsd,
  };
}
