export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface OsAlert {
  id: string;
  severity: AlertSeverity;
  createdAt: number;
  ackDeadlineAt?: number;
}

const severityRank: Record<AlertSeverity, number> = { critical: 3, warning: 2, info: 1 };

export function sortBySeverity(alerts: OsAlert[]): OsAlert[] {
  return [...alerts].sort((left, right) => severityRank[right.severity] - severityRank[left.severity] || left.createdAt - right.createdAt);
}

export function ackableWithin(alert: OsAlert, now: number): boolean {
  return alert.ackDeadlineAt === undefined || now <= alert.ackDeadlineAt;
}
