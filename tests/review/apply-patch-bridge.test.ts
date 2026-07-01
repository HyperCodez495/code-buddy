/**
 * apply_patch → review gate wiring: dry-run compute, bridge outcomes, and the
 * tool's gated path behind CODEBUDDY_DIFF_REVIEW (off path untouched).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { ApplyPatchTool, computePatchedFiles, parsePatch } from '../../src/tools/apply-patch.js';
import { applyPatchWithReview } from '../../src/review/apply-patch-bridge.js';
import { resetCheckpointManager } from '../../src/checkpoints/checkpoint-manager.js';
import type { CouncilChatClient } from '../../src/council/types.js';

let workDir: string;
let previousCwd: string;
let previousEnv: string | undefined;

beforeEach(() => {
  resetCheckpointManager();
  previousCwd = process.cwd();
  previousEnv = process.env.CODEBUDDY_DIFF_REVIEW;
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-bridge-'));
});

afterEach(() => {
  process.chdir(previousCwd);
  if (previousEnv === undefined) delete process.env.CODEBUDDY_DIFF_REVIEW;
  else process.env.CODEBUDDY_DIFF_REVIEW = previousEnv;
  resetCheckpointManager();
  fs.rmSync(workDir, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const abs = path.join(workDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function read(rel: string): string {
  return fs.readFileSync(path.join(workDir, rel), 'utf-8');
}

const UPDATE_PATCH = [
  '*** Begin Patch',
  '*** Update File: a.ts',
  '@@',
  '-const a = 1;',
  '+const a = 2;',
  '*** End Patch',
].join('\n');

describe('computePatchedFiles (dry-run)', () => {
  it('computes full resulting content for add/update/delete/move without writing', () => {
    write('a.ts', 'const a = 1;\nconst keep = true;\n');
    write('dead.ts', 'x\n');
    write('moved.ts', 'const m = 1;\n');
    const ops = parsePatch(
      [
        '*** Begin Patch',
        '*** Add File: fresh.ts',
        '+created',
        '*** Delete File: dead.ts',
        '*** Update File: a.ts',
        '@@',
        '-const a = 1;',
        '+const a = 2;',
        '*** Update File: moved.ts',
        '*** Move to: renamed.ts',
        '@@',
        '-const m = 1;',
        '+const m = 2;',
        '*** End Patch',
      ].join('\n'),
    );

    const { changes, errors } = computePatchedFiles(ops, workDir);

    expect(errors).toEqual([]);
    const byPath = new Map(changes.map((c) => [c.path, c.newContent]));
    expect(byPath.get('fresh.ts')).toBe('created');
    expect(byPath.get('dead.ts')).toBeNull();
    expect(byPath.get('a.ts')).toBe('const a = 2;\nconst keep = true;\n');
    expect(byPath.get('renamed.ts')).toBe('const m = 2;\n');
    expect(byPath.get('moved.ts')).toBeNull();
    // Nothing was written.
    expect(read('a.ts')).toContain('const a = 1;');
    expect(fs.existsSync(path.join(workDir, 'fresh.ts'))).toBe(false);
  });

  it('is strict: a failed hunk is an error, not a partial resolve', () => {
    write('a.ts', 'completely different content\n');
    const ops = parsePatch(UPDATE_PATCH);
    const { changes, errors } = computePatchedFiles(ops, workDir);
    expect(errors[0]).toMatch(/Hunk failed/);
    expect(changes).toEqual([]);
  });
});

describe('applyPatchWithReview (bridge)', () => {
  it('static mode: clean patch → reviewed, applied transactionally, ok summary', async () => {
    write('a.ts', 'const a = 1;\n');
    const { changes } = computePatchedFiles(parsePatch(UPDATE_PATCH), workDir);

    const outcome = await applyPatchWithReview({ changes, cwd: workDir, intent: 'bump a' }, { mode: 'static' });

    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toMatch(/review accepted \(static: static-gate\)/);
    expect(read('a.ts')).toBe('const a = 2;\n');
    expect(fs.existsSync(path.join(workDir, '.codebuddy', 'diff-reviews.jsonl'))).toBe(true);
  });

  it('static mode: introduced secret → blocked with annotations, nothing applied', async () => {
    write('a.ts', 'const a = 1;\n');
    const outcome = await applyPatchWithReview(
      { changes: [{ path: 'a.ts', newContent: 'const k = "AKIAABCDEFGHIJKLMNOP";\n' }], cwd: workDir, intent: 'sneak' },
      { mode: 'static' },
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toMatch(/REJECTED/);
    expect(outcome.summary).toMatch(/\[blocker\] a\.ts/);
    expect(read('a.ts')).toBe('const a = 1;\n');
  });

  it('full mode: an annotate verdict comes back as actionable revision guidance', async () => {
    write('a.ts', 'const a = 1;\n');
    const client: CouncilChatClient = {
      async chat() {
        return {
          content:
            '{"decision":"annotate","annotations":[{"path":"a.ts","line":1,"severity":"warning","message":"add a unit test for the new value","suggestedFix":"expect(a).toBe(2)"}],"why":"revise"}',
          promptTokens: 1,
          totalTokens: 2,
        };
      },
    };

    const outcome = await applyPatchWithReview(
      { changes: [{ path: 'a.ts', newContent: 'const a = 2;\n' }], cwd: workDir, intent: 'bump a' },
      { mode: 'full', client },
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toMatch(/requests changes/);
    expect(outcome.summary).toMatch(/\[warning\] a\.ts:1 — add a unit test/);
    expect(outcome.summary).toMatch(/fix: expect\(a\)\.toBe\(2\)/);
    expect(read('a.ts')).toBe('const a = 1;\n');
  });

  it('full mode with client=null fails CLOSED with a retry hint', async () => {
    write('a.ts', 'const a = 1;\n');
    const outcome = await applyPatchWithReview(
      { changes: [{ path: 'a.ts', newContent: 'const a = 2;\n' }], cwd: workDir, intent: 'bump a' },
      { mode: 'full', client: null },
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toMatch(/review UNAVAILABLE/);
    expect(outcome.summary).toMatch(/CODEBUDDY_DIFF_REVIEW=static/);
    expect(read('a.ts')).toBe('const a = 1;\n');
  });
});

describe('ApplyPatchTool — gated behind CODEBUDDY_DIFF_REVIEW', () => {
  it('off (default): legacy path, no review artifacts', async () => {
    delete process.env.CODEBUDDY_DIFF_REVIEW;
    write('a.ts', 'const a = 1;\n');
    process.chdir(workDir);

    const result = await new ApplyPatchTool().execute({ patch: UPDATE_PATCH });

    expect(result.success).toBe(true);
    expect(read('a.ts')).toBe('const a = 2;\n');
    expect(fs.existsSync(path.join(workDir, '.codebuddy'))).toBe(false);
  });

  it('static: applies through the gate and journals', async () => {
    process.env.CODEBUDDY_DIFF_REVIEW = 'static';
    write('a.ts', 'const a = 1;\n');
    process.chdir(workDir);

    const result = await new ApplyPatchTool().execute({ patch: UPDATE_PATCH, intent: 'bump a' });

    expect(result.success).toBe(true);
    expect(result.output).toMatch(/review accepted/);
    expect(read('a.ts')).toBe('const a = 2;\n');
    const ledger = JSON.parse(read('.codebuddy/diff-reviews.jsonl').trim());
    expect(ledger.intent).toBe('bump a');
    expect(ledger.applied).toBe(true);
  });

  it('static: a blocked patch returns the annotations as the tool error', async () => {
    process.env.CODEBUDDY_DIFF_REVIEW = 'static';
    write('a.ts', 'const a = 1;\n');
    process.chdir(workDir);
    const secretPatch = [
      '*** Begin Patch',
      '*** Update File: a.ts',
      '@@',
      '-const a = 1;',
      '+const k = "AKIAABCDEFGHIJKLMNOP";',
      '*** End Patch',
    ].join('\n');

    const result = await new ApplyPatchTool().execute({ patch: secretPatch });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/REJECTED/);
    expect(result.error).toMatch(/AWS access key/);
    expect(read('a.ts')).toBe('const a = 1;\n');
  });

  it('static: an unresolvable patch fails closed before any review', async () => {
    process.env.CODEBUDDY_DIFF_REVIEW = 'static';
    write('a.ts', 'totally different\n');
    process.chdir(workDir);

    const result = await new ApplyPatchTool().execute({ patch: UPDATE_PATCH });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not resolve/);
    expect(read('a.ts')).toBe('totally different\n');
  });
});
