import { describe, expect, it } from 'vitest';

import { renderCodexAutonomyDirective } from '../../../src/agent/autonomous/codex-autonomy-directive.js';
import type { AgenticCodingTaskContract } from '../../../src/agent/autonomous/agentic-coding-contract.js';

function contract(overrides: Partial<AgenticCodingTaskContract> = {}): AgenticCodingTaskContract {
  return {
    repo: '/repo',
    task: 'Modernize one autonomous coding path.',
    allowedPaths: ['src/agent/...', 'tests/agent/...'],
    verification: ['npm test -- tests/agent/autonomous/codex-autonomy-directive.test.ts'],
    riskLevel: 'low',
    output: 'text',
    maxFilesChanged: 4,
    maxToolRounds: 32,
    memoryPolicy: 'handoff',
    fleetPolicy: 'none',
    edits: [],
    ...overrides,
  };
}

describe('codex autonomy directive', () => {
  it('renders bounded Codex-style coding behavior without granting extra authority', () => {
    const directive = renderCodexAutonomyDirective(contract());

    expect(directive).toContain('Codex-style autonomous coding directive');
    expect(directive).toContain('Scope: src/agent/..., tests/agent/...');
    expect(directive).toContain('Keep an explicit plan');
    expect(directive).toContain('Protect user work');
    expect(directive).toContain('exact replace_text operations');
    expect(directive).toContain('Stop honestly');
    expect(directive).not.toContain('bypass');
  });

  it('keeps the declared runner budget visible to producer agents', () => {
    const directive = renderCodexAutonomyDirective(contract({
      maxFilesChanged: 2,
      maxToolRounds: 12,
    }));

    expect(directive).toContain('at most 2 changed file(s), 12 tool round(s)');
  });
});
