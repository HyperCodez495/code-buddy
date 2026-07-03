/**
 * `memory.*` IPC — the per-project MemoryBrowser + inline editor (Claude
 * Cowork parity Phase 2 step 17): list memory entries and add/update/delete
 * them, scoped to the active (or explicitly named) project. Thin layer over
 * {@link ProjectMemoryService}.
 *
 * Extracted from the main index.ts god-file. Reads TWO runtime mutables —
 * `projectManager` and `projectMemoryServiceRef` — so both are injected as
 * ACCESSORS (getters) and read at call time. Bodies copied verbatim.
 *
 * @module main/ipc/memory-ipc
 */

import { ipcMain } from 'electron';
import type { ProjectManager } from '../project/project-manager';
import type { ProjectMemoryService } from '../project/project-memory';

export interface MemoryIpcDeps {
  /** Current ProjectManager (null until the DB is open) — accessor. */
  getProjectManager: () => ProjectManager | null;
  /** Current ProjectMemoryService (null until wired) — accessor. */
  getProjectMemoryService: () => ProjectMemoryService | null;
}

export function registerMemoryIpcHandlers(deps: MemoryIpcDeps): void {
  const { getProjectManager, getProjectMemoryService } = deps;

  // ── Memory listing for MemoryBrowser (Claude Cowork parity) ──────────
  ipcMain.handle('memory.list', async (_event, projectId?: string) => {
    const projectManager = getProjectManager();
    const projectMemoryServiceRef = getProjectMemoryService();
    if (!projectManager || !projectMemoryServiceRef) return [];
    const id = projectId ?? projectManager.getActiveId();
    if (!id) return [];
    return projectMemoryServiceRef.listMemoryEntries(id);
  });

  // Phase 2 step 17: memory CRUD for inline editor
  ipcMain.handle(
    'memory.add',
    async (
      _event,
      category: 'preference' | 'pattern' | 'context' | 'decision',
      content: string,
      projectId?: string
    ) => {
      const projectManager = getProjectManager();
      const projectMemoryServiceRef = getProjectMemoryService();
      if (!projectManager || !projectMemoryServiceRef) {
        return { success: false, error: 'Memory service unavailable' };
      }
      const id = projectId ?? projectManager.getActiveId();
      if (!id) return { success: false, error: 'No active project' };
      return projectMemoryServiceRef.addMemoryEntry(id, category, content);
    }
  );

  ipcMain.handle(
    'memory.update',
    async (
      _event,
      entryIndex: number,
      newContent: string,
      newCategory?: 'preference' | 'pattern' | 'context' | 'decision',
      projectId?: string
    ) => {
      const projectManager = getProjectManager();
      const projectMemoryServiceRef = getProjectMemoryService();
      if (!projectManager || !projectMemoryServiceRef) {
        return { success: false, error: 'Memory service unavailable' };
      }
      const id = projectId ?? projectManager.getActiveId();
      if (!id) return { success: false, error: 'No active project' };
      return projectMemoryServiceRef.updateMemoryEntry(id, entryIndex, newContent, newCategory);
    }
  );

  ipcMain.handle('memory.delete', async (_event, entryIndex: number, projectId?: string) => {
    const projectManager = getProjectManager();
    const projectMemoryServiceRef = getProjectMemoryService();
    if (!projectManager || !projectMemoryServiceRef) {
      return { success: false, error: 'Memory service unavailable' };
    }
    const id = projectId ?? projectManager.getActiveId();
    if (!id) return { success: false, error: 'No active project' };
    return projectMemoryServiceRef.deleteMemoryEntry(id, entryIndex);
  });
}
