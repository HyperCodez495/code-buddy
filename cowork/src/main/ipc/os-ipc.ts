import { ipcMain } from 'electron';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

/**
 * Mission Control OS data bridge — reads the REAL Code Buddy ledgers the CLI
 * council writes (no mock data, fail-open on missing/corrupt files):
 *
 * - `~/.codebuddy/council-deliberation-health.jsonl` — one line per council
 *   run (Deliberation Health Index + run stats), written by the core's
 *   `src/council/deliberation-health.ts`.
 * - `~/.codebuddy/fleet-model-performance.jsonl` — the model scoreboard (one
 *   line per seated model per run: quality, role, latency, cost).
 *
 * Both files belong to the CLI; Cowork only READS them.
 */

interface CouncilHealthLine {
  at: string;
  taskType?: string;
  planMode?: string;
  seats?: number;
  answers?: number;
  judgeAlive?: number;
  dhi?: number;
}

interface ScoreboardLine {
  at: string;
  taskType?: string;
  model?: string;
  provider?: string;
  role?: string;
  won?: boolean;
  quality?: number;
  latencyMs?: number;
  costUsd?: number;
  failed?: boolean;
}

export interface OsCouncilVerdict {
  agentId: string;
  model: string;
  label: string;
  score: number;
  stance: 'approve' | 'revise' | 'reject';
}

export interface OsCouncilSession {
  id: string;
  title: string;
  dhi: number;
  verdicts: OsCouncilVerdict[];
}

export interface OsCouncilHealthPayload {
  session: OsCouncilSession | null;
  /** DHI history, oldest → newest (for trend rendering). */
  history: Array<{ at: string; taskType: string; dhi: number }>;
}

/** A scoreboard entry belongs to a run when written within this window. */
const RUN_MATCH_WINDOW_MS = 90_000;

function codebuddyDir(): string {
  return path.join(os.homedir(), '.codebuddy');
}

async function readJsonlLines<T>(file: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const out: T[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as T);
      } catch {
        // one corrupt line never hides the rest of the ledger
      }
    }
    return out;
  } catch {
    return [];
  }
}

function toVerdict(entry: ScoreboardLine, index: number): OsCouncilVerdict | null {
  if (!entry.model || typeof entry.quality !== 'number') return null;
  const score = Math.max(0, Math.min(1, entry.quality));
  return {
    // Role qualifies the id — the same model can sit twice (member + reviewer).
    agentId: `${entry.provider ?? 'unknown'}:${entry.model}:${entry.role ?? index}`,
    model: entry.model,
    label: entry.role ? `${entry.model} · ${entry.role}` : entry.model,
    score,
    stance: entry.won ? 'approve' : score >= 0.5 ? 'revise' : 'reject',
  };
}

/** The latest council run as an arena session, plus the DHI history. */
export async function readCouncilHealth(historyLimit = 20, dir = codebuddyDir()): Promise<OsCouncilHealthPayload> {
  const health = await readJsonlLines<CouncilHealthLine>(path.join(dir, 'council-deliberation-health.jsonl'));
  const valid = health.filter((line) => typeof line.at === 'string' && typeof line.dhi === 'number');
  if (valid.length === 0) return { session: null, history: [] };

  const last = valid[valid.length - 1]!;
  const lastAt = Date.parse(last.at);

  const scoreboard = await readJsonlLines<ScoreboardLine>(path.join(dir, 'fleet-model-performance.jsonl'));
  const verdicts = scoreboard
    .filter((entry) => {
      const at = Date.parse(entry.at ?? '');
      return Number.isFinite(at) && Math.abs(at - lastAt) <= RUN_MATCH_WINDOW_MS && !entry.failed;
    })
    .map((entry, index) => toVerdict(entry, index))
    .filter((v): v is OsCouncilVerdict => v !== null);

  return {
    session: {
      id: last.at,
      title: `Council · ${last.taskType ?? 'run'} (${last.answers ?? 0}/${last.seats ?? 0} sièges)`,
      dhi: last.dhi ?? 0,
      verdicts,
    },
    history: valid.slice(-historyLimit).map((line) => ({
      at: line.at,
      taskType: line.taskType ?? 'run',
      dhi: line.dhi ?? 0,
    })),
  };
}

// ---------------------------------------------------------------------------
// Collective Knowledge Graph — read the append-only CKG ledger
// (~/.codebuddy/collective/ckg-ledger.jsonl, written by the core's
// collective-knowledge-graph.ts). Read-only fold: last write per id wins,
// tombstones/retracts drop the id.
// ---------------------------------------------------------------------------

interface CkgLedgerLine {
  kind?: string;
  id?: string;
  type?: string;
  name?: string;
  text?: string;
  confidence?: number;
  sourceId?: string;
  targetId?: string;
  relType?: string;
}

export interface OsKnowledgeNode {
  id: string;
  type: 'lesson' | 'decision' | 'fact' | 'discovery';
  label: string;
  confidence?: number;
}

export interface OsKnowledgeEdge {
  from: string;
  to: string;
  kind: string;
}

export interface OsKnowledgeGraphPayload {
  nodes: OsKnowledgeNode[];
  edges: OsKnowledgeEdge[];
  /** True when nodes were dropped to respect maxNodes. */
  truncated: boolean;
}

const KNOWN_NODE_TYPES = new Set(['lesson', 'decision', 'fact', 'discovery']);

/** Fold the CKG ledger into current nodes + edges (newest last). */
export async function readKnowledgeGraph(maxNodes = 4000, dir = codebuddyDir()): Promise<OsKnowledgeGraphPayload> {
  const lines = await readJsonlLines<CkgLedgerLine>(path.join(dir, 'collective', 'ckg-ledger.jsonl'));
  const nodes = new Map<string, OsKnowledgeNode>();
  const edges: OsKnowledgeEdge[] = [];

  for (const line of lines) {
    if (line.kind === 'entity' && line.id && KNOWN_NODE_TYPES.has(line.type ?? '')) {
      nodes.delete(line.id); // re-insert so the LAST write also gets the newest position
      nodes.set(line.id, {
        id: line.id,
        type: line.type as OsKnowledgeNode['type'],
        label: (line.name || line.text || line.id).slice(0, 160),
        ...(typeof line.confidence === 'number' ? { confidence: line.confidence } : {}),
      });
    } else if (line.kind === 'relation' && line.sourceId && line.targetId) {
      edges.push({ from: line.sourceId, to: line.targetId, kind: line.relType ?? 'related_to' });
    } else if ((line.kind === 'tombstone' || line.kind === 'retract') && line.id) {
      nodes.delete(line.id);
    }
  }

  const all = Array.from(nodes.values());
  const truncated = all.length > maxNodes;
  // Newest entries are the most relevant in the cockpit — keep the tail.
  const kept = truncated ? all.slice(all.length - maxNodes) : all;
  const keptIds = new Set(kept.map((n) => n.id));
  return {
    nodes: kept,
    edges: edges.filter((e) => keptIds.has(e.from) && keptIds.has(e.to)),
    truncated,
  };
}

export function registerOsIpcHandlers() {
  ipcMain.handle('os.councilHealth', async (_event, historyLimit?: number) => {
    try {
      return await readCouncilHealth(historyLimit);
    } catch {
      return { session: null, history: [] } satisfies OsCouncilHealthPayload;
    }
  });

  ipcMain.handle('os.knowledgeGraph', async (_event, maxNodes?: number) => {
    try {
      return await readKnowledgeGraph(maxNodes);
    } catch {
      return { nodes: [], edges: [], truncated: false } satisfies OsKnowledgeGraphPayload;
    }
  });
}
