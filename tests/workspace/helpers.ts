import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Workspace } from '../../src/workspace/workspace-config.js';

export function makeTempRoot(prefix = 'codebuddy-workspace-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function makeGitRepo(parent: string, name: string): string {
  const repo = path.join(parent, name);
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  return fs.realpathSync(repo);
}

export function writeWorkspaceConfig(
  configPath: string,
  repos: Array<{ name: string; path: string; description?: string }>,
): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ repos }, null, 2), 'utf8');
}

export function asWorkspace(configPath: string, repos: Array<{ name: string; path: string }>): Workspace {
  return { configPath, repos };
}
