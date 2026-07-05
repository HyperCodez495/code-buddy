/**
 * DeliberationPanel — council verdict roll-up with minority quote support.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/DeliberationPanel
 */

import { useTranslation } from 'react-i18next';
import { MessagesSquare, Quote } from 'lucide-react';
import { scoreSpread, shouldQuoteMinority, type Verdict } from '../utils/deliberation-model';

export interface DeliberationPanelProps {
  verdicts: Verdict[];
  dhi: number;
  minorityQuote?: string;
}

function positionClasses(position: Verdict['position']): string {
  if (position === 'support') return 'bg-success/15 text-success';
  if (position === 'oppose') return 'bg-destructive/15 text-destructive';
  return 'bg-warning/15 text-warning';
}

export function DeliberationPanel({ verdicts, dhi, minorityQuote }: DeliberationPanelProps) {
  const { t } = useTranslation();
  const spread = scoreSpread(verdicts);
  const showMinority = !!minorityQuote && shouldQuoteMinority(spread);

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="deliberation-panel">
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <div className="rounded-lg bg-primary/15 p-2 text-primary">
          <MessagesSquare aria-hidden="true" className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t('genspark.deliberation.title', 'Délibération council')}
          </h2>
          <p className="text-xs text-muted-foreground">
            DHI {dhi.toFixed(2)} · spread {spread.toFixed(2)}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {verdicts.map((verdict) => (
          <article
            key={verdict.id}
            className="rounded-lg border border-border bg-background p-3"
            data-testid={`verdict-${verdict.id}`}
          >
            <div className="flex items-center gap-2">
              <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={verdict.model}>
                {verdict.model}
              </h3>
              <span className={`rounded-full px-2 py-0.5 text-xs ${positionClasses(verdict.position)}`}>
                {verdict.position}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {Math.round(verdict.score * 100)}%
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{verdict.reason}</p>
          </article>
        ))}
      </div>

      {showMinority && (
        <blockquote className="mt-4 rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground">
            <Quote aria-hidden="true" className="h-4 w-4" />
            {t('genspark.deliberation.minority', 'Citation minoritaire')}
          </div>
          “{minorityQuote}”
        </blockquote>
      )}
    </section>
  );
}
