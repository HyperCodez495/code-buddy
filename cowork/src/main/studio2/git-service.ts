import * as childProcess from 'node:child_process';
import { promisify } from 'node:util';
import { errorMessage, fail, ok, safeResolve, type Studio2Result } from './archive-utils.js';

const gitFileAsync = promisify(childProcess.execFile);

export interface GitChange { path: string; status: string; }
export interface GitStatus { branch: string; changes: GitChange[]; clean: boolean; }
export interface GitCommitResult { hash: string; message: string; }
export interface GitLogEntry { hash: string; subject: string; author: string; date: string; }

async function git(projectRoot: string, args: string[]): Promise<string> {
  const { stdout } = await gitFileAsync('git', args, { cwd: projectRoot });
  return String(stdout).trim();
}
function parsePorcelain(output: string): GitChange[] {
  return output.split('\n').filter(Boolean).map((line) => ({ status: line.slice(0, 2).trim() || 'modified', path: line.slice(3).trim() }));
}

export class GitService {
  async init(projectRoot: string): Promise<Studio2Result<{ initialized: boolean }>> {
    try { const root = safeResolve(projectRoot); if (!root) return fail('Invalid project root'); await git(root, ['init']); return ok({ initialized: true }); } catch (error) { return fail(errorMessage(error)); }
  }
  async status(projectRoot: string): Promise<Studio2Result<GitStatus>> {
    try { const root = safeResolve(projectRoot); if (!root) return fail('Invalid project root'); const branch = await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'HEAD'); const changes = parsePorcelain(await git(root, ['status', '--porcelain'])); return ok({ branch, changes, clean: changes.length === 0 }); } catch (error) { return fail(errorMessage(error)); }
  }
  async commit(projectRoot: string, message: string): Promise<Studio2Result<GitCommitResult>> {
    try { const root = safeResolve(projectRoot); if (!root) return fail('Invalid project root'); const trimmed = message.trim(); if (!trimmed) return fail('Commit message is required'); await git(root, ['add', '--all']); await git(root, ['commit', '-m', trimmed]); const hash = await git(root, ['rev-parse', '--short', 'HEAD']); return ok({ hash, message: trimmed }); } catch (error) { return fail(errorMessage(error)); }
  }
  async log(projectRoot: string, limit = 20): Promise<Studio2Result<GitLogEntry[]>> {
    try { const root = safeResolve(projectRoot); if (!root) return fail('Invalid project root'); const safeLimit = Math.max(1, Math.min(100, Math.floor(limit))); const output = await git(root, ['log', '--pretty=format:%h|%s|%an|%ad', '--date=short', '-n', String(safeLimit)]).catch(() => ''); return ok(output.split('\n').filter(Boolean).map((line) => { const [hash = '', subject = '', author = '', date = ''] = line.split('|'); return { hash, subject, author, date }; })); } catch (error) { return fail(errorMessage(error)); }
  }
}
