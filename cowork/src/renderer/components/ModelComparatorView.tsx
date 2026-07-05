/**
 * ModelComparatorView — side-by-side Mixture-of-Agents answer comparison.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/ModelComparatorView
 */

import { useTranslation } from 'react-i18next';
import { CheckCircle2, Scale } from 'lucide-react';
import { agreementRate, rankAnswers, type ModelAnswer } from '../utils/comparator-model';
import { MessageMarkdown } from './MessageMarkdown';

export interface ModelComparatorViewProps {
  answers: ModelAnswer[];
  onPick: (answer: ModelAnswer) => void;
}

export function ModelComparatorView({ answers, onPick }: ModelComparatorViewProps) {
  const { t } = useTranslation();
  const ranked = rankAnswers(answers);
  const agreement = Math.round(agreementRate(answers) * 100);

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="model-comparator-view">
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <div className="rounded-lg bg-primary/15 p-2 text-primary">
          <Scale aria-hidden="true" className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t('genspark.comparator.title', 'Comparaison modèles')}
          </h2>
          <p className="text-xs text-muted-foreground">
            {answers.length} réponses · accord {agreement}%
          </p>
        </div>
      </div>

      {ranked.length === 0 ? (
        <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
          {t('genspark.comparator.empty', 'Aucune réponse à comparer.')}
        </div>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {ranked.map((answer) => (
            <article
              key={answer.id}
              className="flex min-h-64 flex-col rounded-lg border border-border bg-background p-3"
              data-testid={`model-answer-${answer.id}`}
            >
              <div className="flex items-center gap-2 border-b border-border pb-2">
                <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={answer.model}>
                  {answer.model}
                </h3>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {Math.round(answer.score * 100)}%
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{answer.stance}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto py-3 text-sm text-muted-foreground">
                <MessageMarkdown normalizedText={answer.answer} />
              </div>
              <button
                type="button"
                aria-label={`Choisir ${answer.model}`}
                className="mt-3 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                data-testid={`model-pick-${answer.id}`}
                onClick={() => onPick(answer)}
              >
                <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
                {t('genspark.comparator.pick', 'Choisir')}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
