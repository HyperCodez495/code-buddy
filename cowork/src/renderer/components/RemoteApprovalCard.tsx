/**
 * RemoteApprovalCard — human-in-the-loop approval request for channel control.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/RemoteApprovalCard
 */

import { useTranslation } from 'react-i18next';
import { Check, ShieldAlert, X } from 'lucide-react';
import { riskLevel, type ApprovalRequest } from '../utils/approval-model';
import { MessageMarkdown } from './MessageMarkdown';

export interface RemoteApprovalCardProps {
  request: ApprovalRequest;
  onApprove: (request: ApprovalRequest) => void;
  onReject: (request: ApprovalRequest) => void;
}

function riskClasses(level: ReturnType<typeof riskLevel>): string {
  if (level === 'high') return 'bg-destructive/15 text-destructive';
  if (level === 'medium') return 'bg-warning/15 text-warning';
  return 'bg-success/15 text-success';
}

export function RemoteApprovalCard({ request, onApprove, onReject }: RemoteApprovalCardProps) {
  const { t } = useTranslation();
  const level = riskLevel(request);

  return (
    <article className="rounded-lg border border-border bg-surface p-4" data-testid={`remote-approval-${request.id}`}>
      <div className="flex items-start gap-3 border-b border-border pb-3">
        <div className={`rounded-lg p-2 ${riskClasses(level)}`}>
          <ShieldAlert aria-hidden="true" className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">{request.action}</h2>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${riskClasses(level)}`}>{level}</span>
            {request.costUsd !== undefined && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                ${request.costUsd.toFixed(2)}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('genspark.approval.subtitle', 'Validation humaine requise avant action distante.')}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground">
        <MessageMarkdown normalizedText={request.diffSummary || t('genspark.approval.noDiff', 'Aucun diff résumé.')} />
      </div>

      {request.riskFactors.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {request.riskFactors.map((factor) => (
            <li key={factor} className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
              {factor}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
        <button
          type="button"
          aria-label={t('genspark.approval.reject', 'Refuser')}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          data-testid="approval-reject"
          onClick={() => onReject(request)}
        >
          <X aria-hidden="true" className="h-4 w-4" />
          {t('genspark.approval.reject', 'Refuser')}
        </button>
        <button
          type="button"
          aria-label={t('genspark.approval.approve', 'Approuver')}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          data-testid="approval-approve"
          onClick={() => onApprove(request)}
        >
          <Check aria-hidden="true" className="h-4 w-4" />
          {t('genspark.approval.approve', 'Approuver')}
        </button>
      </div>
    </article>
  );
}
