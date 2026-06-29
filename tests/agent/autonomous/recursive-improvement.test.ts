import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { AgenticCodingTaskContract } from '../../../src/agent/autonomous/agentic-coding-contract.js';
import {
  renderAgenticCodingRunReport,
  type AgenticCodingRunReport,
} from '../../../src/agent/autonomous/agentic-coding-runner.js';
import { buildRecursiveImprovementDecision } from '../../../src/agent/autonomous/recursive-improvement.js';

function contract(overrides: Partial<AgenticCodingTaskContract> = {}): AgenticCodingTaskContract {
  return {
    repo: path.resolve('.'),
    task: 'Improve the autonomous coding runner.',
    allowedPaths: ['src/agent/autonomous/...', 'tests/agent/autonomous/...'],
    verification: ['npm test -- tests/agent/autonomous/recursive-improvement.test.ts'],
    riskLevel: 'low',
    output: 'text',
    maxFilesChanged: 6,
    maxToolRounds: 120,
    memoryPolicy: 'handoff',
    fleetPolicy: 'none',
    edits: [],
    ...overrides,
  };
}

function report(overrides: Partial<AgenticCodingRunReport> = {}): AgenticCodingRunReport {
  const baseContract = contract();

  return {
    approval: {
      reason: 'No scoped edits were declared.',
      requiredBeforeApply: false,
      state: 'not_required',
    },
    autoExecutable: true,
    blockedReasons: [],
    contract: baseContract,
    dirtyFiles: [],
    editPreviewRequired: false,
    editPreviewRequested: false,
    editPreviews: [],
    editRequested: false,
    editResults: [],
    fleet: {
      allowedTools: [],
      chainRoles: [],
      mode: 'disabled',
      policy: 'none',
      safety: [],
    },
    generatedAt: '2026-06-28T00:00:00.000Z',
    plan: [],
    repo: baseContract.repo,
    rulesFiles: [],
    status: 'verified',
    taskFile: path.join(baseContract.repo, 'task.json'),
    validationErrors: [],
    verification: [
      {
        command: baseContract.verification[0]!,
        exitCode: 0,
        status: 'passed',
        stdout: '',
        stderr: '',
      },
    ],
    verificationRequested: true,
    workflow: {
      blockedNodeIds: [],
      completedNodeIds: [],
      edges: [],
      nodeErrors: [],
      nodes: [],
    },
    ...overrides,
  };
}

describe('buildRecursiveImprovementDecision', () => {
  it('proposes a bounded next task after a verified low-risk pass', () => {
    const decision = buildRecursiveImprovementDecision(report(), {
      currentDepth: 0,
      maxDepth: 2,
    });

    expect(decision.status).toBe('next_ready');
    expect(decision.depth).toEqual({ current: 0, max: 2, remaining: 2 });
    expect(decision.nextTask).toEqual(expect.objectContaining({
      allowedPaths: ['src/agent/autonomous/...', 'tests/agent/autonomous/...'],
      edits: [],
      maxFilesChanged: 5,
      maxToolRounds: 80,
      riskLevel: 'low',
      verification: ['npm test -- tests/agent/autonomous/recursive-improvement.test.ts'],
    }));
    expect(decision.nextTask?.task).toContain('Recursive improvement 1');
    expect(decision.techniques).toEqual(expect.arrayContaining([
      'bounded task contract',
      'verification and self-correction loop',
      'memory handoff',
    ]));
  });

  it('stops when the previous pass is not verified', () => {
    const decision = buildRecursiveImprovementDecision(report({
      status: 'ready',
      verification: [],
    }));

    expect(decision.status).toBe('stopped');
    expect(decision.nextTask).toBeUndefined();
    expect(decision.reason).toMatch(/requires a verified previous iteration/i);
  });

  it('blocks recursion when verification evidence failed', () => {
    const decision = buildRecursiveImprovementDecision(report({
      status: 'verified',
      verification: [
        {
          command: 'npm test',
          exitCode: 1,
          status: 'failed',
          stdout: '',
          stderr: 'failure',
        },
      ],
    }));

    expect(decision.status).toBe('blocked');
    expect(decision.nextTask).toBeUndefined();
    expect(decision.reason).toMatch(/verification evidence/i);
  });

  it('stops at the configured recursive depth limit', () => {
    const decision = buildRecursiveImprovementDecision(report(), {
      currentDepth: 2,
      maxDepth: 2,
    });

    expect(decision.status).toBe('stopped');
    expect(decision.nextTask).toBeUndefined();
    expect(decision.reason).toMatch(/depth limit/i);
  });
});

describe('renderAgenticCodingRunReport recursive improvement section', () => {
  it('renders the recursive improvement decision', () => {
    const decision = buildRecursiveImprovementDecision(report());
    const rendered = renderAgenticCodingRunReport(report({ recursiveImprovement: decision }));

    expect(rendered).toContain('Recursive improvement:');
    expect(rendered).toContain('- Status: next_ready');
    expect(rendered).toContain('- Next task: Recursive improvement 1');
  });
});
