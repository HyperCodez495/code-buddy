import { getDataRedactionEngine } from '../security/data-redaction.js';
import {
  buildRunRecallPackAsync,
  type BuildRunRecallPackOptions,
  type RunRecallPack,
} from './run-recall-pack.js';

export const MOBILE_SUPERVISION_SNAPSHOT_SCHEMA_VERSION = 1;

export type MobileSupervisionMode = 'review_only';
export const MOBILE_SUPERVISION_ALLOWED_ACTIONS = [
  'view_run_summary',
  'open_artifact',
  'copy_recall_pack',
  'draft_followup_prompt',
] as const;
export const MOBILE_SUPERVISION_BLOCKED_ACTIONS = [
  'execute_tool',
  'modify_files',
  'send_email',
  'approve_sensitive_operation',
  'read_secret_values',
  'push_changes',
] as const;

export type MobileSupervisionAllowedAction = typeof MOBILE_SUPERVISION_ALLOWED_ACTIONS[number];
export type MobileSupervisionBlockedAction = typeof MOBILE_SUPERVISION_BLOCKED_ACTIONS[number];

export interface MobileSupervisionActionDecision {
  action: string;
  allowed: boolean;
  requiresLocalOperator: boolean;
  reason: string;
}

export interface BuildMobileSupervisionSnapshotOptions extends BuildRunRecallPackOptions {
  includeAllContext?: boolean;
}

export interface MobileSupervisionRunCard {
  artifactPaths: string[];
  bestSnippet?: string;
  objective: string;
  runId: string;
  source?: string;
  startedAt: number;
  status: RunRecallPack['runs'][number]['status'];
}

export interface MobileSupervisionSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  mode: MobileSupervisionMode;
  query: string;
  safety: {
    autoDispatch: false;
    localApprovalRequired: true;
    outreachDisabled: true;
    remoteExecutionDisabled: true;
    redaction: 'secrets-redacted';
  };
  allowedActions: MobileSupervisionAllowedAction[];
  blockedActions: MobileSupervisionBlockedAction[];
  redactionCount: number;
  recallPack: {
    count: number;
    filters: RunRecallPack['filters'];
    lessonCount: number;
    memoryCount: number;
    promptContext: string;
    runCount: number;
    schemaVersion: RunRecallPack['schemaVersion'];
    sessionCount: number;
  };
  runs: MobileSupervisionRunCard[];
}

export async function buildMobileSupervisionSnapshot(
  query: string,
  options: BuildMobileSupervisionSnapshotOptions = {},
): Promise<MobileSupervisionSnapshot> {
  const includeAllContext = options.includeAllContext === true;
  const pack = await buildRunRecallPackAsync(query, {
    ...options,
    includeLessons: includeAllContext || options.includeLessons,
    includeMemories: includeAllContext || options.includeMemories,
    includeSessions: includeAllContext || options.includeSessions,
  });
  const redactor = getDataRedactionEngine();
  let redactionCount = 0;

  const redact = (text: string): string => {
    const result = redactor.redact(text);
    redactionCount += result.redactions.length;
    return result.redacted;
  };

  const runs = pack.runs.map((run): MobileSupervisionRunCard => ({
    artifactPaths: [...new Set(run.matches.map(match => match.artifact).filter(isNonEmptyString))],
    bestSnippet: run.matches[0]?.snippet ? redact(run.matches[0].snippet) : undefined,
    objective: redact(run.objective),
    runId: run.runId,
    source: run.source,
    startedAt: run.startedAt,
    status: run.status,
  }));

  const promptContext = redact(pack.promptContext);

  return {
    schemaVersion: MOBILE_SUPERVISION_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'review_only',
    query: pack.query,
    safety: {
      autoDispatch: false,
      localApprovalRequired: true,
      outreachDisabled: true,
      remoteExecutionDisabled: true,
      redaction: 'secrets-redacted',
    },
    allowedActions: [...MOBILE_SUPERVISION_ALLOWED_ACTIONS],
    blockedActions: [...MOBILE_SUPERVISION_BLOCKED_ACTIONS],
    redactionCount,
    recallPack: {
      count: pack.count,
      filters: pack.filters,
      lessonCount: pack.lessonCount,
      memoryCount: pack.memoryCount,
      promptContext,
      runCount: pack.runCount,
      schemaVersion: pack.schemaVersion,
      sessionCount: pack.sessionCount,
    },
    runs,
  };
}

export function evaluateMobileSupervisionAction(
  snapshot: Pick<MobileSupervisionSnapshot, 'allowedActions' | 'blockedActions' | 'safety'>,
  action: string,
): MobileSupervisionActionDecision {
  if (snapshot.allowedActions.includes(action as MobileSupervisionAllowedAction)) {
    return {
      action,
      allowed: true,
      requiresLocalOperator: false,
      reason: 'Allowed as a review-only supervision action; it must not execute tools or mutate local state.',
    };
  }

  if (snapshot.blockedActions.includes(action as MobileSupervisionBlockedAction)) {
    return {
      action,
      allowed: false,
      requiresLocalOperator: true,
      reason: snapshot.safety.remoteExecutionDisabled
        ? 'Blocked because mobile supervision disables remote execution and requires local operator approval.'
        : 'Blocked by the mobile supervision policy.',
    };
  }

  return {
    action,
    allowed: false,
    requiresLocalOperator: true,
    reason: 'Unknown mobile supervision action; deny by default until explicitly added to the review-only allowlist.',
  };
}

export function renderMobileSupervisionSnapshot(snapshot: MobileSupervisionSnapshot): string {
  const lines: string[] = [
    `Mobile supervision snapshot (${snapshot.mode})`,
    `Query: ${snapshot.query || '(empty)'}`,
    `Runs: ${snapshot.recallPack.runCount} | lessons: ${snapshot.recallPack.lessonCount} | memories: ${snapshot.recallPack.memoryCount} | sessions: ${snapshot.recallPack.sessionCount}`,
    `Safety: local approval required, remote execution disabled, outreach disabled, ${snapshot.redactionCount} redaction(s)`,
    `Allowed: ${snapshot.allowedActions.join(', ')}`,
    `Blocked: ${snapshot.blockedActions.join(', ')}`,
  ];

  if (snapshot.runs.length > 0) {
    lines.push('', 'Runs:');
    for (const run of snapshot.runs) {
      const source = run.source ? ` source:${run.source}` : '';
      lines.push(`- ${run.runId} ${run.status}${source}`);
      lines.push(`  ${run.objective}`);
      if (run.artifactPaths.length > 0) {
        lines.push(`  artifacts: ${run.artifactPaths.join(', ')}`);
      }
      if (run.bestSnippet) {
        lines.push(`  snippet: ${run.bestSnippet}`);
      }
    }
  }

  return lines.join('\n');
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}
