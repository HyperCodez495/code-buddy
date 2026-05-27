import {
  approvalSchema,
  capabilitySchema,
  proofSchema,
  runSchema,
  sensitiveActionSchema,
  type Approval,
  type Capability,
  type Proof,
  type Run,
  type SensitiveAction,
} from '../harness/index.js';
import type { BrowserOperatorSessionDraft } from './browser-operator-session.js';

export interface BrowserOperatorHarnessBundle {
  run: Run;
  proof: Proof;
  sensitiveAction: SensitiveAction;
  approval?: Approval;
  capabilities: Capability[];
}

export interface BrowserOperatorHarnessBundleOptions {
  session: BrowserOperatorSessionDraft;
  artifactRef: string;
  success: boolean;
  stopped: boolean;
  createdAt?: number;
}

const BROWSER_OPERATOR_ACTION_ID = 'codebuddy.browser_operator.execute';

export function buildBrowserOperatorHarnessBundle(
  options: BrowserOperatorHarnessBundleOptions,
): BrowserOperatorHarnessBundle {
  const createdAt = options.createdAt ?? Date.now();
  const startedAt = parseDateMs(options.session.consent.grantedAt) ?? createdAt;
  const runStatus = options.success ? 'completed' : options.stopped ? 'cancelled' : 'failed';
  const riskLevel = options.session.mode === 'local' ? 'high' : 'medium';

  const sensitiveAction = sensitiveActionSchema.parse({
    kind: 'sensitive-action',
    schemaVersion: 1,
    id: BROWSER_OPERATOR_ACTION_ID,
    name: 'Execute browser operator session',
    riskLevel,
    defaultDryRun: true,
    requires: 'approval-required',
  });

  const approval = options.session.consent.granted
    ? approvalSchema.parse({
        kind: 'approval',
        schemaVersion: 1,
        id: `approval_${options.session.sessionId}_browser_operator`,
        target: sensitiveAction.id,
        runId: options.session.sessionId,
        decision: 'approved',
        reviewer: options.session.consent.grantedBy ?? 'human-operator',
        reason: 'Browser operator consent was granted for this controlled session.',
        decidedAt: startedAt,
        scope: options.session.consent.scopes.join(','),
      })
    : undefined;

  return {
    run: runSchema.parse({
      kind: 'run',
      schemaVersion: 1,
      id: options.session.sessionId,
      actor: {
        type: 'agent',
        id: 'code-buddy-browser-operator',
        provider: 'stagehand',
      },
      objective: options.session.goal,
      status: runStatus,
      startedAt,
      endedAt: createdAt,
      metadata: {
        channel: 'browser-operator',
        sessionId: options.session.sessionId,
        organ: 'code-buddy',
        tags: ['browser', 'computer-use', options.session.mode],
      },
    }),
    proof: proofSchema.parse({
      kind: 'proof',
      schemaVersion: 1,
      id: `proof_${options.session.sessionId}_browser_operator`,
      runId: options.session.sessionId,
      type: 'artifact',
      createdAt,
      producedBy: {
        type: 'agent',
        id: 'code-buddy-browser-operator',
        provider: 'stagehand',
      },
      summary: `Browser operator ${runStatus}: ${summarizeActionLog(options.session)}`,
      ref: options.artifactRef,
    }),
    sensitiveAction,
    ...(approval ? { approval } : {}),
    capabilities: [
      capabilitySchema.parse({
        kind: 'capability',
        schemaVersion: 1,
        id: 'codebuddy.browser_operator.read',
        name: 'Inspect browser state',
        level: 'read',
        policy: 'autonomous',
        fleetPolicy: 'read-only-help',
        description: 'Navigate, observe, extract and assert browser state without mutating a page.',
      }),
      capabilitySchema.parse({
        kind: 'capability',
        schemaVersion: 1,
        id: 'codebuddy.browser_operator.live_control',
        name: 'Control a browser session',
        level: 'sensitive',
        policy: 'approval-required',
        fleetPolicy: 'none',
        description: 'Click, type, upload, download, alter storage or otherwise mutate a browser session.',
      }),
    ],
  };
}

function parseDateMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function summarizeActionLog(session: BrowserOperatorSessionDraft): string {
  const completed = session.actionLog.filter((entry) => entry.status === 'completed').length;
  const blocked = session.actionLog.filter((entry) => entry.status === 'blocked').length;
  const stopped = session.actionLog.filter((entry) => entry.status === 'stopped').length;
  return `${completed}/${session.actionLog.length} completed, ${blocked} blocked, ${stopped} stopped`;
}
