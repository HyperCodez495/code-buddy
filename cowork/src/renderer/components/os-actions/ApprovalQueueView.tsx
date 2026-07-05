import { CheckCircle2, ShieldAlert, XCircle } from 'lucide-react';

import { Pill } from '../ui/Pill.js';
import { partitionByRisk, riskLevel, type ApprovalRequest } from './utils/approval-queue-model.js';

export interface ApprovalQueueViewProps {
  requests: ApprovalRequest[];
  selectedIds: string[];
  onToggle: (requestId: string) => void;
  onApprove: (requestIds: string[]) => void;
  onReject: (requestIds: string[]) => void;
}

function riskTone(score: number) {
  const level = riskLevel(score);
  if (level === 'critical' || level === 'high') return 'danger' as const;
  if (level === 'medium') return 'warning' as const;
  return 'success' as const;
}

export function ApprovalQueueView({ requests, selectedIds, onToggle, onApprove, onReject }: ApprovalQueueViewProps) {
  const groups = partitionByRisk(requests);
  const selected = selectedIds.filter((id) => requests.some((request) => request.id === id));

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-primary" />
          <h3 className="text-base font-semibold text-foreground">File d’approbation</h3>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={selected.length === 0} onClick={() => onApprove(selected)} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> Approuver</button>
          <button type="button" disabled={selected.length === 0} onClick={() => onReject(selected)} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"><XCircle className="h-4 w-4" /> Refuser</button>
        </div>
      </div>
      <div className="mt-4 space-y-4">
        {(['critical', 'high', 'medium', 'low'] as const).map((level) => groups[level].length > 0 && (
          <div key={level} className="space-y-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{level}</div>
            {groups[level].map((request) => (
              <label key={request.id} className="flex gap-3 rounded-lg border border-border bg-background p-3">
                <input type="checkbox" checked={selectedIds.includes(request.id)} onChange={() => onToggle(request.id)} />
                <span className="flex-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium text-foreground">{request.action}<Pill tone={riskTone(request.riskScore)}>{request.riskScore}</Pill></span>
                  <span className="mt-1 block text-xs text-muted-foreground">{request.summary}</span>
                </span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
