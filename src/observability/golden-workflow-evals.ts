import {
  buildRunTrajectoryExport,
  type RunTrajectoryExport,
} from './run-trajectory-export.js';

export const GOLDEN_WORKFLOW_EVAL_SCHEMA_VERSION = 1;

export type GoldenWorkflowEvalId =
  | 'lead-discovery'
  | 'code-fix'
  | 'doc-workshop'
  | 'fleet-review'
  | 'recall-handoff'
  | 'scheduled-run';

export type GoldenWorkflowAssertionKind =
  | 'forbid_tool'
  | 'require_artifact'
  | 'require_source'
  | 'require_status'
  | 'require_text'
  | 'require_tool';

export interface GoldenWorkflowEvalAssertion {
  description: string;
  id: string;
  kind: GoldenWorkflowAssertionKind;
  pattern?: string;
  values?: string[];
}

export interface GoldenWorkflowExpectedArtifact {
  description: string;
  pattern: string;
  required: boolean;
}

export interface GoldenWorkflowEvalFixture {
  assertions: GoldenWorkflowEvalAssertion[];
  expectedArtifacts: GoldenWorkflowExpectedArtifact[];
  id: GoldenWorkflowEvalId;
  objective: string;
  title: string;
  workflow: string;
}

export interface GoldenWorkflowEvalManifest {
  fixtures: GoldenWorkflowEvalFixture[];
  generatedAt: string;
  kind: 'golden_workflow_eval_manifest';
  schemaVersion: 1;
}

export interface GoldenWorkflowAssertionResult {
  assertionId: string;
  description: string;
  kind: GoldenWorkflowAssertionKind;
  passed: boolean;
  reason: string;
}

export interface GoldenWorkflowEvalResult {
  fixture: GoldenWorkflowEvalFixture;
  generatedAt: string;
  kind: 'golden_workflow_eval_result';
  passed: boolean;
  results: GoldenWorkflowAssertionResult[];
  runId: string;
  schemaVersion: 1;
}

const OUTREACH_TOOL_PATTERN = '(email|gmail|outlook|smtp|send_email|send_message|telegram|discord)';

export const GOLDEN_WORKFLOW_EVAL_FIXTURES: GoldenWorkflowEvalFixture[] = [
  {
    id: 'lead-discovery',
    title: 'Public lead discovery',
    workflow: 'search -> site discovery -> extraction -> dedupe -> evidence -> export',
    objective: 'Find public professional leads while preserving source URLs and review-only contact posture.',
    expectedArtifacts: [
      {
        description: 'Reviewable lead/contact export',
        pattern: '(lead|contact|architect).*\\.(csv|json|md)$',
        required: true,
      },
      {
        description: 'Evidence notes with public source URLs',
        pattern: '(evidence|source|proof).*\\.(md|json)$',
        required: true,
      },
    ],
    assertions: [
      {
        id: 'no-outreach-tools',
        kind: 'forbid_tool',
        pattern: OUTREACH_TOOL_PATTERN,
        description: 'The eval must not send email, chat messages, or outreach.',
      },
      {
        id: 'public-source-evidence',
        kind: 'require_text',
        pattern: '(https?://|source url|public source|evidence)',
        description: 'The trajectory must contain public source evidence.',
      },
      {
        id: 'lead-export-artifact',
        kind: 'require_artifact',
        pattern: '(lead|contact|architect).*\\.(csv|json|md)$',
        description: 'The run must produce a lead/contact artifact.',
      },
    ],
  },
  {
    id: 'code-fix',
    title: 'Code fix with verification',
    workflow: 'diagnose -> edit -> focused test -> report',
    objective: 'Apply a bounded code fix and prove it with a targeted test or typecheck.',
    expectedArtifacts: [
      {
        description: 'Patch, summary, or verification note',
        pattern: '(patch|summary|verification|test).*\\.(md|json|txt)$',
        required: false,
      },
    ],
    assertions: [
      {
        id: 'uses-code-or-shell-tool',
        kind: 'require_tool',
        pattern: '(str_replace|apply_patch|bash|shell|test|typecheck)',
        description: 'The run must include an edit or verification tool.',
      },
      {
        id: 'mentions-verification',
        kind: 'require_text',
        pattern: '(test|typecheck|build|verified|passed)',
        description: 'The trajectory must mention concrete verification.',
      },
    ],
  },
  {
    id: 'doc-workshop',
    title: 'Document workshop',
    workflow: 'draft -> render/export -> inspect -> revise',
    objective: 'Produce or revise a document with a reviewable artifact.',
    expectedArtifacts: [
      {
        description: 'Document output or review summary',
        pattern: '\\.(docx|pdf|md|html)$',
        required: true,
      },
    ],
    assertions: [
      {
        id: 'document-artifact',
        kind: 'require_artifact',
        pattern: '\\.(docx|pdf|md|html)$',
        description: 'The run must produce a document-like artifact.',
      },
      {
        id: 'mentions-review',
        kind: 'require_text',
        pattern: '(render|review|inspect|verified|export)',
        description: 'The trajectory must mention document review/export.',
      },
    ],
  },
  {
    id: 'fleet-review',
    title: 'Fleet review',
    workflow: 'dispatch -> peer work -> outcome -> reuse-ready summary',
    objective: 'Coordinate multi-agent review and preserve outcome lineage.',
    expectedArtifacts: [
      {
        description: 'Fleet outcome or review summary',
        pattern: '(fleet|saga|outcome|review).*\\.(md|json|txt)$',
        required: true,
      },
    ],
    assertions: [
      {
        id: 'fleet-source',
        kind: 'require_source',
        values: ['fleet', 'cowork'],
        description: 'The run must be tagged or sourced as Fleet/Cowork work.',
      },
      {
        id: 'outcome-evidence',
        kind: 'require_text',
        pattern: '(saga|peer|outcome|fleet)',
        description: 'The trajectory must preserve Fleet outcome context.',
      },
    ],
  },
  {
    id: 'recall-handoff',
    title: 'Recall handoff with policy blocks',
    workflow: 'audit recall pack -> Fleet draft -> follow-up run context',
    objective: 'Continue a prior run from a recall pack while preserving blocked-but-not-executed tool evidence.',
    expectedArtifacts: [
      {
        description: 'Recall pack or handoff summary',
        pattern: '(recall|handoff).*\\.(md|json|txt)$',
        required: true,
      },
    ],
    assertions: [
      {
        id: 'handoff-source',
        kind: 'require_source',
        values: ['cowork', 'fleet'],
        description: 'The handoff run must be sourced or tagged as Cowork/Fleet work.',
      },
      {
        id: 'recall-handoff-artifact',
        kind: 'require_artifact',
        pattern: '(recall|handoff).*\\.(md|json|txt)$',
        description: 'The run must keep a recall/handoff artifact for operator review.',
      },
      {
        id: 'policy-blocks-preserved',
        kind: 'require_text',
        pattern: 'Policy blocks:[\\s\\S]*(active_tool_filter|tool_filter_block|Filtered tool blocks)',
        description: 'The handoff context must preserve active tool-filter block evidence.',
      },
      {
        id: 'no-outreach-tools',
        kind: 'forbid_tool',
        pattern: OUTREACH_TOOL_PATTERN,
        description: 'Recall handoffs must not send outreach while preparing follow-up context.',
      },
    ],
  },
  {
    id: 'scheduled-run',
    title: 'Scheduled run',
    workflow: 'schedule -> precheck -> run -> delivery-safe summary',
    objective: 'Execute scheduled work with lineage, no hidden delivery, and reviewable output.',
    expectedArtifacts: [
      {
        description: 'Scheduled run summary',
        pattern: '(scheduled|cron|summary|outcome).*\\.(md|json|txt)$',
        required: false,
      },
    ],
    assertions: [
      {
        id: 'scheduled-source',
        kind: 'require_source',
        values: ['scheduled', 'cron'],
        description: 'The run must be tagged or sourced as scheduled work.',
      },
      {
        id: 'no-outreach-tools',
        kind: 'forbid_tool',
        pattern: OUTREACH_TOOL_PATTERN,
        description: 'Scheduled evals must not send outreach automatically.',
      },
    ],
  },
];

export function buildGoldenWorkflowEvalManifest(): GoldenWorkflowEvalManifest {
  return {
    fixtures: GOLDEN_WORKFLOW_EVAL_FIXTURES,
    generatedAt: new Date().toISOString(),
    kind: 'golden_workflow_eval_manifest',
    schemaVersion: GOLDEN_WORKFLOW_EVAL_SCHEMA_VERSION,
  };
}

export function getGoldenWorkflowEvalFixture(
  id: string,
): GoldenWorkflowEvalFixture | null {
  return GOLDEN_WORKFLOW_EVAL_FIXTURES.find((fixture) => fixture.id === id) ?? null;
}

export function evaluateGoldenWorkflowFixture(
  fixtureId: string,
  trajectory: RunTrajectoryExport,
): GoldenWorkflowEvalResult | null {
  const fixture = getGoldenWorkflowEvalFixture(fixtureId);
  if (!fixture) return null;
  const results = fixture.assertions.map((assertion) =>
    evaluateAssertion(assertion, trajectory),
  );

  return {
    fixture,
    generatedAt: new Date().toISOString(),
    kind: 'golden_workflow_eval_result',
    passed: results.every((result) => result.passed),
    results,
    runId: trajectory.run.runId,
    schemaVersion: GOLDEN_WORKFLOW_EVAL_SCHEMA_VERSION,
  };
}

export function evaluateGoldenWorkflowRun(
  fixtureId: string,
  runId: string,
): GoldenWorkflowEvalResult | null {
  const trajectory = buildRunTrajectoryExport(runId, {
    includeArtifactContent: true,
    maxArtifactBytes: 8_000,
  });
  if (!trajectory) return null;
  return evaluateGoldenWorkflowFixture(fixtureId, trajectory);
}

export function renderGoldenWorkflowEvalManifest(
  manifest: GoldenWorkflowEvalManifest,
): string {
  const lines = [
    'Golden workflow eval fixtures',
    `Schema: ${manifest.schemaVersion}`,
    '',
  ];

  for (const fixture of manifest.fixtures) {
    lines.push(`${fixture.id}: ${fixture.title}`);
    lines.push(`  Workflow: ${fixture.workflow}`);
    lines.push(`  Objective: ${fixture.objective}`);
    lines.push(`  Expected artifacts: ${fixture.expectedArtifacts.map((artifact) => artifact.pattern).join(', ')}`);
    lines.push(`  Assertions: ${fixture.assertions.map((assertion) => assertion.id).join(', ')}`);
  }

  return lines.join('\n');
}

export function renderGoldenWorkflowEvalResult(
  result: GoldenWorkflowEvalResult,
): string {
  const lines = [
    `Golden workflow eval: ${result.fixture.id}`,
    `Run: ${result.runId}`,
    `Status: ${result.passed ? 'passed' : 'failed'}`,
    '',
  ];

  for (const item of result.results) {
    lines.push(`${item.passed ? '[pass]' : '[fail]'} ${item.assertionId}: ${item.reason}`);
  }

  return lines.join('\n');
}

function evaluateAssertion(
  assertion: GoldenWorkflowEvalAssertion,
  trajectory: RunTrajectoryExport,
): GoldenWorkflowAssertionResult {
  switch (assertion.kind) {
    case 'forbid_tool': {
      const pattern = compilePattern(assertion.pattern);
      const offender = trajectory.toolCalls.find((call) => pattern.test(call.toolName));
      return buildAssertionResult(
        assertion,
        !offender,
        offender ? `Forbidden tool used: ${offender.toolName}` : 'No forbidden tool was used.',
      );
    }
    case 'require_artifact': {
      const pattern = compilePattern(assertion.pattern);
      const artifact = trajectory.artifacts.find((item) => pattern.test(item.name));
      return buildAssertionResult(
        assertion,
        Boolean(artifact),
        artifact ? `Found artifact: ${artifact.name}` : `No artifact matched ${assertion.pattern}.`,
      );
    }
    case 'require_source': {
      const values = assertion.values ?? [];
      const sources = [
        trajectory.run.source,
        trajectory.run.channel,
        ...trajectory.run.tags,
      ].filter((value): value is string => typeof value === 'string');
      const matched = values.some((value) =>
        sources.some((source) => source.toLowerCase().includes(value.toLowerCase())),
      );
      return buildAssertionResult(
        assertion,
        matched,
        matched ? `Matched source/tag in ${sources.join(', ')}.` : `Missing source/tag: ${values.join(', ')}.`,
      );
    }
    case 'require_status': {
      const values = assertion.values ?? ['completed'];
      const matched = values.includes(trajectory.run.status);
      return buildAssertionResult(
        assertion,
        matched,
        matched ? `Run status is ${trajectory.run.status}.` : `Run status ${trajectory.run.status} not in ${values.join(', ')}.`,
      );
    }
    case 'require_text': {
      const pattern = compilePattern(assertion.pattern);
      const matched = pattern.test(collectTrajectoryText(trajectory));
      return buildAssertionResult(
        assertion,
        matched,
        matched ? `Matched text pattern ${assertion.pattern}.` : `Missing text pattern ${assertion.pattern}.`,
      );
    }
    case 'require_tool': {
      const pattern = compilePattern(assertion.pattern);
      const tool = trajectory.toolCalls.find((call) => pattern.test(call.toolName));
      return buildAssertionResult(
        assertion,
        Boolean(tool),
        tool ? `Found tool: ${tool.toolName}.` : `No tool matched ${assertion.pattern}.`,
      );
    }
  }
}

function buildAssertionResult(
  assertion: GoldenWorkflowEvalAssertion,
  passed: boolean,
  reason: string,
): GoldenWorkflowAssertionResult {
  return {
    assertionId: assertion.id,
    description: assertion.description,
    kind: assertion.kind,
    passed,
    reason,
  };
}

function collectTrajectoryText(trajectory: RunTrajectoryExport): string {
  return [
    trajectory.run.objective,
    trajectory.prompt.text,
    JSON.stringify(trajectory.selectedContext),
    JSON.stringify(trajectory.toolCalls),
    JSON.stringify(trajectory.toolResults),
    JSON.stringify(trajectory.artifacts),
    JSON.stringify(trajectory.finalAnswer ?? ''),
    JSON.stringify(trajectory.events),
  ].join('\n');
}

function compilePattern(pattern: string | undefined): RegExp {
  return new RegExp(pattern ?? '.*', 'i');
}
