/**
 * `ckg.*` IPC — the Collective Knowledge Graph read-only admin surface for
 * the new-shell Knowledge panel: stats/list of indexed discoveries plus the
 * research-ingest topic set (topicsList/topicsAdd/topicsRemove). Namespaced
 * `ckg.*` to avoid the per-project `knowledge.*` channels. Core modules load
 * lazily via loadCoreModule (never bundled); all handlers never-throw.
 *
 * Extracted from the main index.ts god-file. Fully self-contained —
 * loadCoreModule is importable and the module-shape types moved in with the
 * handlers, so no accessor injection. Bodies copied verbatim.
 *
 * @module main/ipc/ckg-ipc
 */

import { ipcMain } from 'electron';
import { loadCoreModule } from '../utils/core-loader';
import { logError } from '../utils/logger';

type CkgModule = {
  getCollectiveKnowledgeGraph: () => {
    getStats: () => { entities: number; superseded: number; relations: number; ledgerPath: string };
    listEntities: (opts: { limit?: number; type?: string }) => Array<{
      id: string;
      name: string;
      type: string;
      source?: string;
      confidence: number;
      mentions: number;
      contributors: number;
      createdAt: string;
    }>;
  };
};
type TopicsModule = {
  loadStoredTopics: () => string[];
  addStoredTopics: (topics: string[]) => string[];
  removeStoredTopics: (topics: string[]) => string[];
};

export function registerCkgIpcHandlers(): void {
  // CKG (Collective Knowledge Graph) — read-only administration surface for the new-shell Knowledge
  // panel. Lists the indexed discoveries + stats, and manages the research-ingest topic set. Namespaced
  // `ckg.*` to avoid the existing per-project `knowledge.*` channels (the KnowledgeBase browser).
  // Loads the core modules via loadCoreModule (never bundled). listEntities/getStats replay the ledger
  // only — no embedding model is loaded — so this is cheap on first open. All handlers never-throw.
  ipcMain.handle('ckg.stats', async () => {
    try {
      const mod = await loadCoreModule<CkgModule>('memory/collective-knowledge-graph.js');
      if (!mod) return null;
      return mod.getCollectiveKnowledgeGraph().getStats();
    } catch (error) {
      logError('[ckg] stats failed:', error);
      return null;
    }
  });

  ipcMain.handle('ckg.list', async (_event, opts?: { limit?: number; type?: string }) => {
    try {
      const mod = await loadCoreModule<CkgModule>('memory/collective-knowledge-graph.js');
      if (!mod) return [];
      const listOpts: { limit?: number; type?: string } = { limit: opts?.limit ?? 200 };
      if (opts?.type) listOpts.type = opts.type;
      return mod.getCollectiveKnowledgeGraph().listEntities(listOpts);
    } catch (error) {
      logError('[ckg] list failed:', error);
      return [];
    }
  });

  ipcMain.handle('ckg.topicsList', async () => {
    try {
      const mod = await loadCoreModule<TopicsModule>('research/research-topics.js');
      if (!mod) return [];
      return mod.loadStoredTopics();
    } catch (error) {
      logError('[ckg] topicsList failed:', error);
      return [];
    }
  });

  ipcMain.handle('ckg.topicsAdd', async (_event, topic: string) => {
    try {
      const mod = await loadCoreModule<TopicsModule>('research/research-topics.js');
      if (!mod || typeof topic !== 'string' || !topic.trim()) return mod ? mod.loadStoredTopics() : [];
      return mod.addStoredTopics([topic.trim()]);
    } catch (error) {
      logError('[ckg] topicsAdd failed:', error);
      return [];
    }
  });

  ipcMain.handle('ckg.topicsRemove', async (_event, topic: string) => {
    try {
      const mod = await loadCoreModule<TopicsModule>('research/research-topics.js');
      if (!mod || typeof topic !== 'string') return mod ? mod.loadStoredTopics() : [];
      return mod.removeStoredTopics([topic]);
    } catch (error) {
      logError('[ckg] topicsRemove failed:', error);
      return [];
    }
  });
}
