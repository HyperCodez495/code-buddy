import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { evaluateScope, loadRepoRules, type RepoRules } from '../../src/agent/scope-awareness.js';
import { AgenticCodingTaskContract } from '../../src/agent/autonomous/agentic-coding-contract.js';

vi.mock('node:fs/promises');
vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, callback: Function) => {
    callback(null, { stdout: '## main...origin/main\n M src/index.ts\n?? docs/new.md\n', stderr: '' });
  }),
}));

describe('scope-awareness', () => {
  let mockClient: any;
  const mockContract: AgenticCodingTaskContract = {
    repo: '/mock/repo',
    task: 'Modify the index file to add logging',
    edits: [{ path: 'src/index.ts', type: 'replace_text', find: 'foo', replace: 'bar', expectedOccurrences: 1 }],
    allowedPaths: ['src/**/*.ts'],
    maxFilesChanged: 10,
    maxToolRounds: 10,
    riskLevel: 'low',
    verification: ['npm test -- tests/unit/example.test.ts'],
    output: 'text',
    memoryPolicy: 'none',
    fleetPolicy: 'none',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockClient = {
      chat: vi.fn(),
    };
  });

  function mockRulesFiles(files: Record<string, string>): void {
    vi.spyOn(fs, 'stat').mockImplementation(async (p: any) => {
      const key = Object.keys(files).find((name) => p.toString().endsWith(name));
      if (key) {
        return { isFile: () => true } as any;
      }
      throw new Error('ENOENT');
    });

    vi.spyOn(fs, 'readFile').mockImplementation(async (p: any) => {
      const key = Object.keys(files).find((name) => p.toString().endsWith(name));
      if (key) {
        return files[key];
      }
      throw new Error('ENOENT');
    });
  }

  it('loads repository rules and pre-existing git changes', async () => {
    mockRulesFiles({
      'AGENTS.md': 'A'.repeat(5000),
      'README.md': 'Readme rules',
    });

    const rules = await loadRepoRules('/mock/repo');

    expect(rules.agentsMd).toHaveLength(4096);
    expect(rules.readme).toBe('Readme rules');
    expect(rules.preexistingChanges).toEqual(['src/index.ts', 'docs/new.md']);
    expect(execFile).toHaveBeenCalledWith(
      'git',
      ['status', '--short', '--branch'],
      { cwd: '/mock/repo' },
      expect.any(Function),
    );
  });

  it('returns allowed and does not query LLM if no rules files exist', async () => {
    vi.spyOn(fs, 'stat').mockRejectedValue(new Error('ENOENT'));

    const result = await evaluateScope(mockContract, mockClient as any);

    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('No repository rule files');
    expect(mockClient.chat).not.toHaveBeenCalled();
  });

  it('denies deterministic destructive requests without querying the LLM', async () => {
    const rules: RepoRules = {
      agentsMd: 'Never run destructive operations.',
      preexistingChanges: [],
    };

    const result = evaluateScope(rules, {
      ...mockContract,
      task: 'After editing, run git push to production',
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('git push');
    expect(result.inferences.join('\n')).toContain('Task text matched safety pattern');
  });

  it('queries LLM and returns compliance outcome if rules files are present', async () => {
    mockRulesFiles({
      'AGENTS.md': 'Rule: Do not change anything in src/legacy/',
    });

    mockClient.chat.mockResolvedValue({
      choices: [{
        message: {
          content: '```json\n{\n  "allowed": true\n}\n```',
        },
      }],
    });

    const result = await evaluateScope(mockContract, mockClient as any);

    expect(result.allowed).toBe(true);
    expect(result.facts).toContain('Loaded AGENTS.md repository rules.');
    expect(result.inferences).toContain('Semantic rule interpretation was provided by the configured LLM client.');
    expect(mockClient.chat).toHaveBeenCalled();
  });

  it('returns allowed: false with reason if LLM reports rule violation', async () => {
    mockRulesFiles({
      'CLAUDE.md': 'Restriction: No edits allowed outside src/utils/',
    });

    mockClient.chat.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            allowed: false,
            reason: 'Task modifies src/index.ts, violating restriction in CLAUDE.md',
          }),
        },
      }],
    });

    const result = await evaluateScope(mockContract, mockClient as any);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('violating restriction in CLAUDE.md');
  });

  it('keeps deterministic allow result if LLM response is malformed or empty', async () => {
    mockRulesFiles({
      'README.md': 'Rule text',
    });

    mockClient.chat.mockResolvedValue({
      choices: [{
        message: {
          content: 'The rules say okay, but no JSON here.',
        },
      }],
    });

    const result = await evaluateScope(mockContract, mockClient as any);

    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('deterministic scope checks passed');
  });

  it('keeps deterministic allow result if LLM call fails', async () => {
    mockRulesFiles({
      'README.md': 'Rule text',
    });

    mockClient.chat.mockRejectedValue(new Error('API rate limit reached'));

    const result = await evaluateScope(mockContract, mockClient as any);

    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('deterministic scope checks passed');
  });
});
