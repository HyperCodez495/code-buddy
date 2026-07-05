/**
 * DryRunPreview — pre-execution plan and cost confirmation surface.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/DryRunPreview
 */

import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Coins, Play, ShieldCheck, X } from 'lucide-react';
import { formatCost, formatEstimateDuration, type CostEstimate, type PlanRisk, type PlanStep } from '../utils/dryrun-estimate';

export interface DryRunPreviewProps {
  plan: PlanStep[];
  estimate: CostEstimate;
  onConfirm: () => void;
  onCancel: () => void;
}

function riskClasses(risk: PlanRisk | undefined): string {
  if (risk === 'high') return 'bg-destructive/15 text-destructive';
  if (risk === 'medium') return 'bg-warning/15 text-warning';
  return 'bg-success/15 text-success';
}

function riskLabel(risk: PlanRisk | undefined): string {
  if (risk === 'high') return 'Risque élevé';
  if (risk === 'medium') return 'Risque moyen';
  return 'Risque faible';
}

export function DryRunPreview({ plan, estimate, onConfirm, onCancel }: DryRunPreviewProps) {
  const { t } = useTranslation();

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="dry-run-preview">
      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t('genspark.dryrun.title', 'Aperçu avant exécution')}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t('genspark.dryrun.subtitle', 'Voici ce que Cowork demandera au noyau Code Buddy.')}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border border-border bg-background px-3 py-2">
            <div className="text-muted-foreground">{t('genspark.dryrun.cost', 'Coût')}</div>
            <div className="mt-1 font-medium text-foreground">{formatCost(estimate.costUsd)}</div>
          </div>
          <div className="rounded-lg border border-border bg-background px-3 py-2">
            <div className="text-muted-foreground">{t('genspark.dryrun.tokens', 'Tokens')}</div>
            <div className="mt-1 font-medium text-foreground">{estimate.totalTokens.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border border-border bg-background px-3 py-2">
            <div className="text-muted-foreground">{t('genspark.dryrun.time', 'Temps')}</div>
            <div className="mt-1 font-medium text-foreground">{formatEstimateDuration(estimate.durationMs)}</div>
          </div>
        </div>
      </div>

      {plan.length === 0 ? (
        <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck aria-hidden="true" className="h-5 w-5" />
          {t('genspark.dryrun.empty', 'Aucune étape à prévisualiser.')}
        </div>
      ) : (
        <ol className="mt-4 space-y-2">
          {plan.map((step, index) => (
            <li
              key={step.id}
              className="rounded-lg border border-border bg-background p-3"
              data-testid={`dry-run-step-${step.id}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium text-foreground">{step.title}</h3>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{step.tool}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${riskClasses(step.risk)}`}>
                      {riskLabel(step.risk)}
                    </span>
                  </div>
                  {step.detail && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={step.detail}>
                      {step.detail}
                    </p>
                  )}
                </div>
                <div className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
                  <Coins aria-hidden="true" className="h-3.5 w-3.5" />
                  {formatCost(step.costUsd ?? 0)}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle aria-hidden="true" className="h-4 w-4 text-warning" />
          {t('genspark.dryrun.guardrail', 'Aucune action réelle ne démarre avant confirmation.')}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            aria-label={t('genspark.dryrun.cancel', 'Annuler')}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            data-testid="dry-run-cancel"
            onClick={onCancel}
          >
            <X aria-hidden="true" className="h-4 w-4" />
            {t('genspark.dryrun.cancel', 'Annuler')}
          </button>
          <button
            type="button"
            aria-label={t('genspark.dryrun.confirm', 'Confirmer')}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            data-testid="dry-run-confirm"
            onClick={onConfirm}
          >
            {plan.length > 0 ? <Play aria-hidden="true" className="h-4 w-4" /> : <CheckCircle2 aria-hidden="true" className="h-4 w-4" />}
            {t('genspark.dryrun.confirm', 'Confirmer')}
          </button>
        </div>
      </div>
    </section>
  );
}
