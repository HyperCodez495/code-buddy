/**
 * GuardrailsBadge — compact autonomy posture and active safety controls.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/GuardrailsBadge
 */

import { useTranslation } from 'react-i18next';
import { Lock, ShieldCheck, Zap } from 'lucide-react';

export interface GuardrailsBadgeProps {
  mode: 'plan' | 'auto' | 'full';
  guardrails: string[];
}

const MODE_LABELS: Record<GuardrailsBadgeProps['mode'], string> = {
  plan: 'Plan',
  auto: 'Auto',
  full: 'Full',
};

function modeClasses(mode: GuardrailsBadgeProps['mode']): string {
  if (mode === 'full') return 'bg-warning/15 text-warning';
  if (mode === 'auto') return 'bg-primary/15 text-primary';
  return 'bg-success/15 text-success';
}

export function GuardrailsBadge({ mode, guardrails }: GuardrailsBadgeProps) {
  const { t } = useTranslation();
  const hasGuardrails = guardrails.length > 0;

  return (
    <aside className="rounded-lg border border-border bg-surface p-3" data-testid="guardrails-badge">
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${modeClasses(mode)}`}>
          {mode === 'full' ? <Zap aria-hidden="true" className="h-4 w-4" /> : <ShieldCheck aria-hidden="true" className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{t('genspark.guardrails.posture', 'Posture active')}</p>
          <p className="text-sm font-medium text-foreground">{MODE_LABELS[mode]}</p>
        </div>
        <span className="ml-auto rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
          {guardrails.length} garde-fous
        </span>
      </div>

      {hasGuardrails ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {guardrails.map((guardrail) => (
            <li
              key={guardrail}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-2 py-1 text-xs text-muted-foreground"
            >
              <Lock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate" title={guardrail}>
                {guardrail}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          {t('genspark.guardrails.empty', 'Aucun garde-fou déclaré pour cette posture.')}
        </p>
      )}
    </aside>
  );
}
