/**
 * Structural gate — the zero-LLM verification layer of the dev-loop.
 * Pure checks + git snapshot delta, on real temp dirs (no mocks).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

import {
  changedFilesBetween,
  checkFileContent,
  formatStructuralEvidence,
  gitStatusSnapshot,
  structuralCheck,
} from '../../src/agent/dev-loop/structural-gate.js';

describe('checkFileContent (pure)', () => {
  it('flags empty files', () => {
    expect(checkFileContent('a.ts', '  \n')).toEqual([{ file: 'a.ts', issue: 'file is empty' }]);
  });

  it('flags unresolved merge-conflict markers', () => {
    const issues = checkFileContent('a.ts', 'ok\n<<<<<<< HEAD\nx\n');
    expect(issues.some((i) => i.issue.includes('merge-conflict'))).toBe(true);
  });

  it('flags omission placeholders', () => {
    const issues = checkFileContent('a.ts', 'const x = 1;\n// ... rest of code\n');
    expect(issues.some((i) => i.issue.includes('omission placeholder'))).toBe(true);
  });

  it('flags invalid JSON only for .json files', () => {
    expect(checkFileContent('broken.json', '{"a": 1,')).toHaveLength(1);
    expect(checkFileContent('notjson.ts', '{"a": 1,')).toEqual([]);
  });

  it('accepts a clean file', () => {
    expect(checkFileContent('ok.ts', 'export const a = 1;\n')).toEqual([]);
  });
});

describe('changedFilesBetween', () => {
  it('abstains (empty) when either snapshot is null', () => {
    expect(changedFilesBetween(null, new Map())).toEqual([]);
    expect(changedFilesBetween(new Map(), null)).toEqual([]);
  });

  it('reports appeared and status-changed files only', () => {
    const before = new Map([
      ['same.ts', ' M'],
      ['staged.ts', 'M '],
    ]);
    const after = new Map([
      ['same.ts', ' M'], // unchanged status → not reported
      ['staged.ts', 'MM'], // status changed → reported
      ['new.ts', '??'], // appeared → reported
    ]);
    expect(changedFilesBetween(before, after).sort()).toEqual(['new.ts', 'staged.ts']);
  });
});

describe('gitStatusSnapshot + structuralCheck (real fs/git)', () => {
  it('returns null outside a git repo (fail-open)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sg-nogit-'));
    expect(await gitStatusSnapshot(dir)).toBeNull();
  });

  it('detects a defective file created between two snapshots', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sg-git-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });

    const before = await gitStatusSnapshot(dir);
    await fs.writeFile(path.join(dir, 'broken.json'), '{"a": 1,');
    const after = await gitStatusSnapshot(dir);

    const touched = changedFilesBetween(before, after);
    expect(touched).toEqual(['broken.json']);

    const issues = await structuralCheck(dir, touched);
    expect(issues).toHaveLength(1);
    expect(formatStructuralEvidence(issues)).toContain('broken.json');
    expect(formatStructuralEvidence(issues)).toContain('invalid JSON');
  });

  it('skips deleted files without failing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sg-del-'));
    expect(await structuralCheck(dir, ['gone.ts'])).toEqual([]);
  });
});
