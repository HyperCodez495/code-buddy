import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck, Lock, Route, ShieldCheck, Waypoints, Workflow } from 'lucide-react';

export interface AgenticHarnessActiveState {
  activePanelId?: string;
  activeStepId?: string;
  approvalState?: string;
  canRunCommand?: boolean;
  missingRequiredCount?: number;
  readyCommandCount?: number;
  recommendedPanelId?: string;
  supervisionState?: string;
  workspaceStatus?: string;
}

export interface AgenticHarnessContractTerm {
  authority?: string;
  definedBy?: string;
  id: string;
  label: string;
  safetyNote?: string;
}

export interface AgenticHarnessLifecycleStage {
  blocksOperation?: boolean;
  coreTouchpoint?: string;
  label: string;
  purpose?: string;
  stage: string;
  userHookEvent?: string;
}

export interface AgenticHarnessNativeSurface {
  codeBuddySurface?: string;
  id: string;
  label: string;
  purpose?: string;
}

export interface AgenticHarnessContract {
  activeState?: AgenticHarnessActiveState;
  canExecute: false;
  contractTerms: AgenticHarnessContractTerm[];
  executionMode: 'display_only';
  hermes?: {
    agentId?: string;
    dispatchProfile?: string;
    lifecycleStages?: AgenticHarnessLifecycleStage[];
    nativeSurfaces?: AgenticHarnessNativeSurface[];
    operatingRules?: string[];
    toolsetId?: string;
  };
  kind: 'agentic-coding-harness-contract';
  label?: string;
  mode: 'passive';
  objective?: string;
  safetyNotes?: string[];
  schemaVersion?: number;
}

export interface AgenticHarnessSummary {
  blockingStageCount: number;
  lifecycleStageCount: number;
  nativeSurfaceCount: number;
  termCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isContractTerm(value: unknown): value is AgenticHarnessContractTerm {
  return isRecord(value) && typeof value.id === 'string' && typeof value.label === 'string';
}

function isLifecycleStage(value: unknown): value is AgenticHarnessLifecycleStage {
  return isRecord(value) && typeof value.stage === 'string' && typeof value.label === 'string';
}

function isNativeSurface(value: unknown): value is AgenticHarnessNativeSurface {
  return isRecord(value) && typeof value.id === 'string' && typeof value.label === 'string';
}

export function isAgenticHarnessContract(value: unknown): value is AgenticHarnessContract {
  if (!isRecord(value)) {
    return false;
  }

  const hermes = isRecord(value.hermes) ? value.hermes : undefined;
  const lifecycleStages = hermes?.lifecycleStages;
  const nativeSurfaces = hermes?.nativeSurfaces;

  return (
    value.kind === 'agentic-coding-harness-contract' &&
    value.mode === 'passive' &&
    value.executionMode === 'display_only' &&
    value.canExecute === false &&
    Array.isArray(value.contractTerms) &&
    value.contractTerms.every(isContractTerm) &&
    (!hermes ||
      ((nativeSurfaces === undefined ||
        (Array.isArray(nativeSurfaces) && nativeSurfaces.every(isNativeSurface))) &&
        (lifecycleStages === undefined ||
          (Array.isArray(lifecycleStages) && lifecycleStages.every(isLifecycleStage))) &&
        (hermes.operatingRules === undefined || isStringArray(hermes.operatingRules))))
  );
}

export function extractAgenticHarnessContract(value: unknown): AgenticHarnessContract | null {
  if (isAgenticHarnessContract(value)) {
    return value;
  }

  if (isRecord(value) && isAgenticHarnessContract(value.harness)) {
    return value.harness;
  }

  return null;
}

export function parseAgenticHarnessArtifact(source: string): AgenticHarnessContract | null {
  try {
    return extractAgenticHarnessContract(JSON.parse(source) as unknown);
  } catch {
    return null;
  }
}

export function summarizeAgenticHarness(harness: AgenticHarnessContract): AgenticHarnessSummary {
  const lifecycleStages = harness.hermes?.lifecycleStages ?? [];
  return {
    blockingStageCount: lifecycleStages.filter((stage) => stage.blocksOperation).length,
    lifecycleStageCount: lifecycleStages.length,
    nativeSurfaceCount: harness.hermes?.nativeSurfaces?.length ?? 0,
    termCount: harness.contractTerms.length,
  };
}

export function buildAgenticHarnessGoal(harness: AgenticHarnessContract): string {
  const lines = [
    'Review this agentic coding harness contract from Cowork.',
    `Mode: ${harness.mode}`,
    `Execution: ${harness.executionMode}`,
    `Can execute: ${String(harness.canExecute)}`,
    `Hermes toolset: ${harness.hermes?.toolsetId ?? 'unknown'}`,
    '',
    'Contract terms:',
    ...harness.contractTerms.map((term) => `- ${term.label}: ${term.safetyNote ?? term.id}`),
    '',
    'Lifecycle hooks:',
    ...(harness.hermes?.lifecycleStages ?? []).map(
      (stage) => `- ${stage.stage}: ${stage.label}${stage.blocksOperation ? ' [blocking]' : ''}`
    ),
    '',
    'Keep this passive: identify the safest next human-facing action and show evidence before any execution.',
  ];

  return lines.join('\n');
}

function formatStateValue(value: unknown): string {
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return 'none';
}

export const AgenticHarnessStrip: React.FC<{
  harness: AgenticHarnessContract;
  onUseAsGoal?: (goal: string) => void;
  sourceKind?: string;
}> = ({ harness, onUseAsGoal, sourceKind }) => {
  const { t } = useTranslation();
  const summary = useMemo(() => summarizeAgenticHarness(harness), [harness]);
  const lifecycleStages = harness.hermes?.lifecycleStages ?? [];
  const nativeSurfaces = harness.hermes?.nativeSurfaces ?? [];
  const visibleTerms = harness.contractTerms.slice(0, 7);
  const visibleStages = lifecycleStages.slice(0, 5);
  const visibleSurfaces = nativeSurfaces.slice(0, 6);
  const state = harness.activeState ?? {};
  const safetyNote = harness.safetyNotes?.[0];

  return (
    <section
      className="rounded border border-zinc-800 bg-zinc-950/35 p-3"
      data-testid="agentic-harness-strip"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-zinc-200">
              {harness.label ?? t('agenticHarness.title', 'Harness contract')}
            </div>
            <div className="mt-0.5 text-[10px] text-zinc-500">
              {sourceKind ?? t('agenticHarness.source', 'agentic workspace')}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
            {harness.mode}
          </span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
            {harness.executionMode}
          </span>
          <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
            {t('agenticHarness.noExecution', 'no execution')}
          </span>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px] md:grid-cols-4">
        <span className="rounded bg-zinc-900/70 px-2 py-1 text-zinc-400">
          {t('agenticHarness.status', 'Status')}: {formatStateValue(state.workspaceStatus)}
        </span>
        <span className="rounded bg-zinc-900/70 px-2 py-1 text-zinc-400">
          {t('agenticHarness.supervision', 'Supervision')}:{' '}
          {formatStateValue(state.supervisionState)}
        </span>
        <span className="rounded bg-zinc-900/70 px-2 py-1 text-zinc-400">
          {t('agenticHarness.approval', 'Approval')}: {formatStateValue(state.approvalState)}
        </span>
        <span className="rounded bg-zinc-900/70 px-2 py-1 text-zinc-400">
          {t('agenticHarness.ready', 'Ready')}: {formatStateValue(state.readyCommandCount)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[9px] text-zinc-500">
          {t('agenticHarness.termsChip', '{{count}} terms', { count: summary.termCount })}
        </span>
        <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[9px] text-zinc-500">
          {t('agenticHarness.hooksChip', '{{count}} hooks', { count: summary.lifecycleStageCount })}
        </span>
        <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[9px] text-zinc-500">
          {t('agenticHarness.blockingChip', '{{count}} blocking', {
            count: summary.blockingStageCount,
          })}
        </span>
        <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[9px] text-zinc-500">
          {harness.hermes?.toolsetId ?? t('agenticHarness.noToolset', 'no toolset')}
        </span>
      </div>

      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] text-zinc-500">
            <ClipboardCheck size={11} className="shrink-0" />
            {t('agenticHarness.contractTerms', 'Contract terms')}
          </div>
          <ul className="space-y-1">
            {visibleTerms.map((term) => (
              <li
                key={term.id}
                className="flex min-w-0 items-center justify-between gap-2 rounded bg-zinc-900/70 px-2 py-1"
              >
                <span className="truncate text-[10px] text-zinc-300">{term.label}</span>
                <span className="shrink-0 rounded bg-zinc-800 px-1 py-0.5 text-[9px] text-zinc-500">
                  {term.id}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] text-zinc-500">
            <Workflow size={11} className="shrink-0" />
            {t('agenticHarness.lifecycle', 'Lifecycle hooks')}
          </div>
          <ul className="space-y-1">
            {visibleStages.map((stage) => (
              <li
                key={stage.stage}
                className="flex min-w-0 items-center justify-between gap-2 rounded bg-zinc-900/70 px-2 py-1"
              >
                <span className="truncate text-[10px] text-zinc-300">{stage.label}</span>
                <span className="flex shrink-0 items-center gap-1 rounded bg-zinc-800 px-1 py-0.5 text-[9px] text-zinc-500">
                  {stage.blocksOperation && <Lock size={8} />}
                  {stage.stage}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {visibleSurfaces.length > 0 && (
        <div className="mt-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] text-zinc-500">
            <Waypoints size={11} className="shrink-0" />
            {t('agenticHarness.surfaces', 'Native surfaces')}
          </div>
          <div className="flex flex-wrap gap-1">
            {visibleSurfaces.map((surface) => (
              <span
                key={surface.id}
                className="rounded bg-zinc-900/70 px-1.5 py-0.5 text-[10px] text-zinc-400"
              >
                {surface.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {(safetyNote || onUseAsGoal) && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 pt-2">
          {safetyNote && (
            <div className="min-w-0 flex-1 text-[10px] text-zinc-500 line-clamp-2">
              {safetyNote}
            </div>
          )}
          {onUseAsGoal && (
            <button
              type="button"
              onClick={() => onUseAsGoal(buildAgenticHarnessGoal(harness))}
              className="flex shrink-0 items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 transition-colors hover:border-accent hover:text-accent"
            >
              <Route size={10} />
              {t('agenticHarness.useAsGoal', 'Use as Fleet goal')}
            </button>
          )}
        </div>
      )}
    </section>
  );
};
