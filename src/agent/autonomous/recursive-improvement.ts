import type { AgenticCodingTaskContract } from './agentic-coding-contract.js';
import type { AgenticCodingRunReport } from './agentic-coding-runner.js';

export type AgenticCodingRecursiveImprovementStatus = 'next_ready' | 'stopped' | 'blocked';

export interface AgenticCodingRecursiveImprovementDecision {
  kind: 'agentic-coding-recursive-improvement';
  schemaVersion: 1;
  status: AgenticCodingRecursiveImprovementStatus;
  depth: {
    current: number;
    max: number;
    remaining: number;
  };
  reason: string;
  nextTask?: AgenticCodingTaskContract;
  stopConditions: string[];
  techniques: string[];
}

export interface BuildRecursiveImprovementDecisionOptions {
  currentDepth?: number;
  maxDepth?: number;
}

export const DEFAULT_MAX_RECURSIVE_IMPROVEMENT_DEPTH = 3;
const MAX_RECURSIVE_IMPROVEMENT_DEPTH = 12;

const RECURSIVE_IMPROVEMENT_STOP_CONDITIONS = [
  'Stop when the configured recursive depth is reached.',
  'Stop unless the previous iteration ended with verified status.',
  'Stop if validation, preflight, approval, edit application, or verification produced blockers.',
  'Stop if verification evidence is missing or any verification command failed.',
  'Stop if the next task would expand allowedPaths, raise risk above low, or skip declared verification.',
  'Stop if repository state is dirty outside the declared scope or user approval is denied.',
] as const;

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, value));
}

function buildDepth(options: BuildRecursiveImprovementDecisionOptions): AgenticCodingRecursiveImprovementDecision['depth'] {
  const max = boundedInteger(
    options.maxDepth,
    DEFAULT_MAX_RECURSIVE_IMPROVEMENT_DEPTH,
    0,
    MAX_RECURSIVE_IMPROVEMENT_DEPTH,
  );
  const current = boundedInteger(options.currentDepth, 0, 0, max);

  return {
    current,
    max,
    remaining: Math.max(0, max - current),
  };
}

function buildTechniques(report: AgenticCodingRunReport): string[] {
  const techniques = [
    'workspace-rule loading',
    'git preflight and scope checks',
    'bounded task contract',
    'agentic planning',
    'scoped edit proposal',
    'preview and approval gates',
    'verification and self-correction loop',
    'observability artifacts',
    'memory handoff',
  ];

  if (report.codeexplorerEvidence || report.worldModelInvariants) {
    techniques.push('CodeExplorer world-model evidence');
  }

  if (report.fleet.policy !== 'none') {
    techniques.push('fleet read-only collaboration');
  }

  return techniques;
}

function stopDecision(
  status: AgenticCodingRecursiveImprovementStatus,
  reason: string,
  depth: AgenticCodingRecursiveImprovementDecision['depth'],
  techniques: string[],
): AgenticCodingRecursiveImprovementDecision {
  return {
    kind: 'agentic-coding-recursive-improvement',
    schemaVersion: 1,
    status,
    depth,
    reason,
    stopConditions: [...RECURSIVE_IMPROVEMENT_STOP_CONDITIONS],
    techniques,
  };
}

function buildNextTask(
  contract: AgenticCodingTaskContract,
  depth: AgenticCodingRecursiveImprovementDecision['depth'],
  techniques: string[],
): AgenticCodingTaskContract {
  const iteration = depth.current + 1;

  return {
    repo: contract.repo,
    task: [
      `Recursive improvement ${iteration}: inspect the verified result of "${contract.task}".`,
      'Choose the smallest next improvement that increases reliability, tests, documentation, maintainability, latency, or autonomous coding quality without expanding scope.',
      `Reuse these techniques: ${techniques.join(', ')}.`,
      'Keep the change low-risk, produce a normal scoped edit proposal, verify it, then reassess whether another iteration is justified.',
    ].join(' '),
    allowedPaths: [...contract.allowedPaths],
    verification: [...contract.verification],
    riskLevel: 'low',
    output: contract.output,
    maxFilesChanged: Math.min(contract.maxFilesChanged, 5),
    maxToolRounds: Math.min(contract.maxToolRounds, 80),
    memoryPolicy: contract.memoryPolicy,
    fleetPolicy: contract.fleetPolicy,
    edits: [],
  };
}

export function buildRecursiveImprovementDecision(
  report: AgenticCodingRunReport,
  options: BuildRecursiveImprovementDecisionOptions = {},
): AgenticCodingRecursiveImprovementDecision {
  const depth = buildDepth(options);
  const techniques = buildTechniques(report);

  if (depth.remaining <= 0) {
    return stopDecision('stopped', 'Recursive improvement depth limit reached.', depth, techniques);
  }

  if (!report.contract) {
    return stopDecision('blocked', 'No validated task contract is available for a recursive improvement pass.', depth, techniques);
  }

  if (report.contract.riskLevel !== 'low') {
    return stopDecision(
      'blocked',
      `Recursive improvement only continues from low-risk contracts; previous risk was ${report.contract.riskLevel}.`,
      depth,
      techniques,
    );
  }

  if (report.validationErrors.length > 0) {
    return stopDecision('blocked', 'Validation errors must be resolved before recursive improvement can continue.', depth, techniques);
  }

  if (report.blockedReasons.length > 0) {
    return stopDecision('blocked', 'Blocked reasons must be resolved before recursive improvement can continue.', depth, techniques);
  }

  if (report.status !== 'verified') {
    return stopDecision(
      'stopped',
      `Recursive improvement requires a verified previous iteration; current status is ${report.status}.`,
      depth,
      techniques,
    );
  }

  if (report.verification.length === 0 || report.verification.some((result) => result.status !== 'passed')) {
    return stopDecision('blocked', 'Verification evidence is missing or not fully passed.', depth, techniques);
  }

  const nextTask = buildNextTask(report.contract, depth, techniques);

  return {
    kind: 'agentic-coding-recursive-improvement',
    schemaVersion: 1,
    status: 'next_ready',
    depth,
    reason: 'Previous iteration is verified and a bounded low-risk next improvement can be proposed.',
    nextTask,
    stopConditions: [...RECURSIVE_IMPROVEMENT_STOP_CONDITIONS],
    techniques,
  };
}
