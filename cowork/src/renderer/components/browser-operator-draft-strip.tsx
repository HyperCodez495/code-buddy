import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, FileJson, Route, ShieldCheck, StopCircle } from 'lucide-react';
import {
  buildBrowserOperatorSessionDraft,
  renderBrowserOperatorSessionDraft,
  type BrowserOperatorMode,
} from '../../../../src/browser-automation/browser-operator-session.js';
import {
  buildInternetScoutPlan,
  renderInternetScoutPlan,
} from '../../../../src/browser-automation/internet-scout-plan.js';

export interface BrowserOperatorScheduleMetadata {
  [key: string]: unknown;
  browserOperatorActionCount: number;
  browserOperatorConsentRequired: boolean;
  browserOperatorMode: BrowserOperatorMode;
  browserOperatorProofArtifact: string;
  browserOperatorSessionId: string;
  browserOperatorSurface: 'cowork';
}

export function buildBrowserOperatorGoalDraft(
  draft: ReturnType<typeof buildBrowserOperatorSessionDraft>,
  plan: ReturnType<typeof buildInternetScoutPlan>,
): string {
  return [
    'Review this Browser Operator draft from Cowork before any browser session starts.',
    renderBrowserOperatorSessionDraft(draft),
    '',
    '## Source Plan',
    renderInternetScoutPlan(plan),
    '',
    'Guardrails: do not bypass login walls, captcha, paywalls, 403/429, or access controls. Stop and report blockers.',
  ].join('\n');
}

export function buildBrowserOperatorScheduleMetadata(
  draft: ReturnType<typeof buildBrowserOperatorSessionDraft>,
): BrowserOperatorScheduleMetadata {
  return {
    browserOperatorSessionId: draft.sessionId,
    browserOperatorSurface: 'cowork',
    browserOperatorMode: draft.mode,
    browserOperatorConsentRequired: draft.consent.required,
    browserOperatorActionCount: draft.actionLog.length,
    browserOperatorProofArtifact: draft.proofExport.artifactName,
  };
}

export const BrowserOperatorDraftStrip: React.FC<{
  goal?: string;
  mode?: BrowserOperatorMode;
  onScheduleGoal?: (goal: string, metadata: BrowserOperatorScheduleMetadata) => void;
  onUseAsGoal?: (goal: string) => void;
}> = ({
  goal,
  mode = 'isolated',
  onScheduleGoal,
  onUseAsGoal,
}) => {
  const { t } = useTranslation();
  const plan = useMemo(
    () => buildInternetScoutPlan({
      goal: normalizeGoal(goal),
      intent: 'research',
      requiresInteraction: false,
      maxPages: 5,
    }),
    [goal],
  );
  const draft = useMemo(
    () => buildBrowserOperatorSessionDraft(plan, { mode }),
    [mode, plan],
  );
  const goalDraft = useMemo(() => buildBrowserOperatorGoalDraft(draft, plan), [draft, plan]);
  const metadata = useMemo(() => buildBrowserOperatorScheduleMetadata(draft), [draft]);
  const visibleActions = draft.actionLog.slice(0, 4);

  return (
    <section
      className="mt-3 rounded border border-cyan-900/60 bg-cyan-950/15 p-2"
      data-testid="fleet-browser-operator-draft"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <ShieldCheck size={11} className="shrink-0 text-cyan-300" />
          <span className="truncate text-[10px] uppercase tracking-wider text-cyan-200/70">
            {t('fleet.browserOperator.title', 'Browser Operator draft')}
          </span>
        </div>
        <span className="shrink-0 rounded bg-cyan-950 px-1.5 py-0.5 text-[10px] text-cyan-200/70">
          {draft.mode}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1">
        <span className="rounded bg-cyan-950/80 px-1 py-0.5 text-[9px] text-cyan-200/60">
          {t('fleet.browserOperator.actionsChip', '{{count}} actions', {
            count: draft.actionLog.length,
          })}
        </span>
        <span className="rounded bg-cyan-950/80 px-1 py-0.5 text-[9px] text-cyan-200/60">
          {draft.consent.required
            ? t('fleet.browserOperator.consentRequiredChip', 'consent required')
            : t('fleet.browserOperator.noLocalConsentChip', 'isolated preview')}
        </span>
        <span className="rounded bg-cyan-950/80 px-1 py-0.5 text-[9px] text-cyan-200/60">
          {t('fleet.browserOperator.proofChip', 'proof export')}
        </span>
      </div>

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-zinc-950/60 px-2 py-1 text-[10px] text-zinc-400">
        <StopCircle size={10} className="shrink-0 text-cyan-300" />
        <span className="truncate">
          {t('fleet.browserOperator.guardrail', 'Visible plan, stop control, no browser launch from this preview')}
        </span>
      </div>

      <ul className="mt-1.5 space-y-1">
        {visibleActions.map((entry) => (
          <li
            key={entry.id}
            className="flex min-w-0 items-center justify-between gap-2 rounded bg-zinc-950/60 px-2 py-1"
            title={entry.reason}
          >
            <span className="truncate text-[10px] text-zinc-300">
              {entry.title}
            </span>
            <span className="shrink-0 rounded bg-cyan-950 px-1 py-0.5 text-[9px] text-cyan-200/60">
              {entry.action ? `${entry.tool}.${entry.action}` : entry.tool}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-zinc-950/60 px-2 py-1 text-[10px] text-zinc-500">
        <FileJson size={10} className="shrink-0 text-zinc-500" />
        <code className="truncate">{draft.proofExport.artifactName}</code>
      </div>

      {(onUseAsGoal || onScheduleGoal) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {onUseAsGoal && (
            <button
              type="button"
              onClick={() => onUseAsGoal(goalDraft)}
              className="flex items-center gap-1 rounded border border-cyan-900/80 px-2 py-1 text-[10px] text-cyan-100/80 transition-colors hover:border-cyan-400 hover:text-cyan-200"
            >
              <Route size={10} />
              {t('fleet.browserOperator.useAsGoal', 'Use draft as goal')}
            </button>
          )}
          {onScheduleGoal && (
            <button
              type="button"
              onClick={() => onScheduleGoal(goalDraft, metadata)}
              className="flex items-center gap-1 rounded border border-cyan-900/80 px-2 py-1 text-[10px] text-cyan-100/80 transition-colors hover:border-cyan-400 hover:text-cyan-200"
            >
              <CalendarPlus size={10} />
              {t('fleet.browserOperator.schedule', 'Schedule review')}
            </button>
          )}
        </div>
      )}
    </section>
  );
};

function normalizeGoal(goal: string | undefined): string {
  const normalized = goal?.trim();
  return normalized && normalized.length > 0
    ? normalized
    : 'Review a public web task with Browser Operator consent, action logs, and proof export.';
}
