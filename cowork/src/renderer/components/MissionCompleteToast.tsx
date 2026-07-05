/**
 * MissionCompleteToast — mission completion notification with reduced-motion support.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/MissionCompleteToast
 */

import { useTranslation } from 'react-i18next';
import { CheckCircle2, ExternalLink, X } from 'lucide-react';
import { formatSummary, type MissionSummary } from '../utils/toast-model';

export interface MissionCompleteToastProps {
  summary: MissionSummary;
  onOpen: () => void;
  onDismiss: () => void;
}

export function MissionCompleteToast({ summary, onOpen, onDismiss }: MissionCompleteToastProps) {
  const { t } = useTranslation();

  return (
    <aside
      className="rounded-lg border border-border bg-surface p-3 shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2"
      data-testid="mission-complete-toast"
      role="status"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-success/15 p-2 text-success">
          <CheckCircle2 aria-hidden="true" className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{t('genspark.toast.title', 'Mission terminée')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{formatSummary(summary)}</p>
          {summary.detail && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={summary.detail}>
              {summary.detail}
            </p>
          )}
          <button
            type="button"
            aria-label={t('genspark.toast.open', 'Ouvrir le résumé')}
            className="mt-3 inline-flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            data-testid="toast-open"
            onClick={onOpen}
          >
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
            {t('genspark.toast.open', 'Ouvrir')}
          </button>
        </div>
        <button
          type="button"
          aria-label={t('genspark.toast.dismiss', 'Fermer')}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          data-testid="toast-dismiss"
          onClick={onDismiss}
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
