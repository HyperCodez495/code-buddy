/**
 * `git.*` IPC — the git status panel + commit composer + worktree manager
 * (Claude Cowork parity Phase 3 step 2): status/stage/unstage/diff/commit,
 * an LLM-free suggestMessage, branch listing, and worktree add/remove/
 * prune/list. Thin layer over the {@link getGitBridge} singleton.
 *
 * Extracted from the main index.ts god-file. Fully self-contained: the
 * only dependency is the importable `getGitBridge()` singleton, so no
 * accessor injection is needed — bodies copied verbatim.
 *
 * @module main/ipc/git-ipc
 */

import { ipcMain } from 'electron';
import { getGitBridge } from '../git/git-bridge';
import { logError } from '../utils/logger';

export function registerGitIpcHandlers(): void {
  // Git status panel + commit composer — Claude Cowork parity Phase 3 step 2
  ipcMain.handle('git.status', async (_event, cwd: string) => {
    try {
      if (!cwd)
        return { isRepo: false, branch: null, upstream: null, ahead: 0, behind: 0, files: [] };
      return getGitBridge().getStatus(cwd);
    } catch (err) {
      logError('[git.status] failed:', err);
      return {
        isRepo: false,
        branch: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        files: [],
        error: (err as Error).message,
      };
    }
  });

  ipcMain.handle('git.stage', async (_event, cwd: string, files: string[]) => {
    try {
      return getGitBridge().stage(cwd, files);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('git.unstage', async (_event, cwd: string, files: string[]) => {
    try {
      return getGitBridge().unstage(cwd, files);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('git.diff', async (_event, cwd: string, file: string, staged: boolean) => {
    try {
      return getGitBridge().diff(cwd, file, staged);
    } catch (err) {
      logError('[git.diff] failed:', err);
      return '';
    }
  });

  ipcMain.handle('git.commit', async (_event, cwd: string, message: string, amend?: boolean) => {
    try {
      return getGitBridge().commit(cwd, message, { amend: !!amend });
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('git.suggestMessage', async (_event, cwd: string) => {
    try {
      return { message: getGitBridge().suggestMessage(cwd) ?? '' };
    } catch (_err) {
      return { message: '' };
    }
  });

  ipcMain.handle('git.branches', async (_event, cwd: string) => {
    try {
      return getGitBridge().listBranches(cwd);
    } catch {
      return [];
    }
  });

  ipcMain.handle('git.worktrees', async (_event, cwd: string) => {
    try {
      return getGitBridge().listWorktrees(cwd);
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    'git.worktreeAdd',
    async (_event, cwd: string, targetPath: string, branch?: string) => {
      try {
        return getGitBridge().addWorktree(cwd, targetPath, branch);
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }
  );

  ipcMain.handle(
    'git.worktreeRemove',
    async (_event, cwd: string, targetPath: string, force?: boolean) => {
      try {
        return getGitBridge().removeWorktree(cwd, targetPath, !!force);
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }
  );

  ipcMain.handle('git.worktreePrune', async (_event, cwd: string) => {
    try {
      return getGitBridge().pruneWorktrees(cwd);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
