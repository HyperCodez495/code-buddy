/**
 * `rules.*` IPC — the permission-rules editor (Claude Cowork parity
 * Phase 2): list/add/remove/update allow+deny rules and a dry-run `test`
 * that classifies a tool call against them. Thin layer over
 * {@link RulesBridge}, scoped to the active project's workspace.
 *
 * Extracted from the main index.ts god-file. Two runtime mutables are read
 * via ACCESSORS: `rulesBridge` (built when the DB opens) and
 * `projectManager` (used by the workspace resolver). The local
 * `resolveRulesWorkspace` helper moved in with the handlers.
 *
 * @module main/ipc/rules-ipc
 */

import { ipcMain } from 'electron';
import type { RulesBridge } from '../security/rules-bridge';
import type { ProjectManager } from '../project/project-manager';

export interface RulesIpcDeps {
  /** Current RulesBridge (null until the DB is open) — accessor, not value. */
  getRulesBridge: () => RulesBridge | null;
  /** Current ProjectManager (null until the DB is open) — accessor. */
  getProjectManager: () => ProjectManager | null;
}

export function registerRulesIpcHandlers(deps: RulesIpcDeps): void {
  const { getRulesBridge, getProjectManager } = deps;

  function resolveRulesWorkspace(projectId?: string): string {
    const projectManager = getProjectManager();
    if (projectManager) {
      const project = projectId ? projectManager.get(projectId) : projectManager.getActive();
      if (project?.workspacePath) return project.workspacePath;
    }
    return process.cwd();
  }

  ipcMain.handle('rules.list', async (_event, projectId?: string) => {
    const rulesBridge = getRulesBridge();
    if (!rulesBridge) return { allow: [], deny: [] };
    return rulesBridge.list(resolveRulesWorkspace(projectId));
  });

  ipcMain.handle(
    'rules.add',
    async (_event, bucket: 'allow' | 'deny', rule: string, projectId?: string) => {
      const rulesBridge = getRulesBridge();
      if (!rulesBridge) {
        return { success: false, error: 'Rules bridge unavailable' };
      }
      return rulesBridge.add(resolveRulesWorkspace(projectId), bucket, rule);
    }
  );

  ipcMain.handle(
    'rules.remove',
    async (_event, bucket: 'allow' | 'deny', rule: string, projectId?: string) => {
      const rulesBridge = getRulesBridge();
      if (!rulesBridge) {
        return { success: false, error: 'Rules bridge unavailable' };
      }
      return rulesBridge.remove(resolveRulesWorkspace(projectId), bucket, rule);
    }
  );

  ipcMain.handle(
    'rules.update',
    async (
      _event,
      bucket: 'allow' | 'deny',
      oldRule: string,
      newRule: string,
      projectId?: string
    ) => {
      const rulesBridge = getRulesBridge();
      if (!rulesBridge) {
        return { success: false, error: 'Rules bridge unavailable' };
      }
      return rulesBridge.update(resolveRulesWorkspace(projectId), bucket, oldRule, newRule);
    }
  );

  ipcMain.handle(
    'rules.test',
    async (_event, toolName: string, toolArgs: Record<string, unknown>, projectId?: string) => {
      const rulesBridge = getRulesBridge();
      if (!rulesBridge) return { decision: 'ask' as const };
      return rulesBridge.test(resolveRulesWorkspace(projectId), toolName, toolArgs);
    }
  );
}
