/**
 * Model Scoreboard — the learning layer for the multi-LLM council.
 *
 * Records, per (taskType × model), the outcome of each council run (won?,
 * judge quality 0-1, latency, cost) to an append-only JSON ledger under
 * ~/.codebuddy/fleet-model-performance.json (same spirit as cost-tracker.ts).
 *
 * The council reads `winRate(taskType, model)` to bias model selection toward
 * the historically-best AI for that kind of task, and `ranking(taskType)` to
 * show what it has learned. This is the piece the Fleet was missing: dispatch +
 * ensemble + consensus existed; *learning which model is best over time* did not.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { logger } from '../utils/logger.js';

export interface OutcomeRecord {
  /** ISO timestamp of the run. */
  at: string;
  /** Inferred or supplied task category (e.g. 'code', 'reasoning', 'french'). */
  taskType: string;
  /** Model id (e.g. 'gpt-5.5', 'grok-3'). */
  model: string;
  /** Provider id (e.g. 'chatgpt', 'grok'). */
  provider: string;
  /** Did this model win the judge's vote this run? */
  won: boolean;
  /** Judge quality score for this answer, 0-1. */
  quality: number;
  /** Wall-clock latency of this model's answer (ms). */
  latencyMs: number;
  /** Marginal cost of this answer in USD (0 for local / flat-fee). */
  costUsd: number;
}

export interface ModelStat {
  model: string;
  provider: string;
  runs: number;
  wins: number;
  /** wins / runs, 0 when never run. */
  winRate: number;
  avgQuality: number;
  avgLatencyMs: number;
  avgCostUsd: number;
}

function defaultLedgerPath(): string {
  return path.join(os.homedir(), '.codebuddy', 'fleet-model-performance.json');
}

export class ModelScoreboard {
  private records: OutcomeRecord[] = [];

  constructor(private readonly file: string = defaultLedgerPath()) {
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.file)) return;
      const raw = fs.readFileSync(this.file, 'utf-8').trim();
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) this.records = parsed as OutcomeRecord[];
    } catch (err) {
      logger.warn?.('[model-scoreboard] could not read ledger, starting empty', {
        err: err instanceof Error ? err.message : String(err),
      });
      this.records = [];
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.records, null, 2), 'utf-8');
    } catch (err) {
      logger.warn?.('[model-scoreboard] could not write ledger', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Append one model's outcome for a run and persist. */
  recordOutcome(rec: OutcomeRecord): void {
    this.records.push(rec);
    this.save();
  }

  /** Historical win rate (0-1) of a model for a task type. 0 when never seen. */
  winRate(taskType: string, model: string): number {
    const runs = this.records.filter((r) => r.taskType === taskType && r.model === model);
    if (runs.length === 0) return 0;
    const wins = runs.filter((r) => r.won).length;
    return wins / runs.length;
  }

  /**
   * Per-model aggregate stats, optionally scoped to one task type, sorted by
   * win rate desc then avg quality desc.
   */
  ranking(taskType?: string): ModelStat[] {
    const scoped = taskType
      ? this.records.filter((r) => r.taskType === taskType)
      : this.records;
    const byModel = new Map<string, OutcomeRecord[]>();
    for (const r of scoped) {
      const arr = byModel.get(r.model) ?? [];
      arr.push(r);
      byModel.set(r.model, arr);
    }
    const stats: ModelStat[] = [];
    for (const [model, runs] of byModel) {
      const wins = runs.filter((r) => r.won).length;
      const n = runs.length;
      stats.push({
        model,
        provider: runs[0]!.provider,
        runs: n,
        wins,
        winRate: wins / n,
        avgQuality: runs.reduce((a, r) => a + r.quality, 0) / n,
        avgLatencyMs: runs.reduce((a, r) => a + r.latencyMs, 0) / n,
        avgCostUsd: runs.reduce((a, r) => a + r.costUsd, 0) / n,
      });
    }
    return stats.sort(
      (a, b) => b.winRate - a.winRate || b.avgQuality - a.avgQuality,
    );
  }

  /** Human-readable learned ranking, for `buddy council --scoreboard`. */
  print(taskType?: string): string {
    const rows = this.ranking(taskType);
    if (rows.length === 0) {
      return taskType
        ? `No council history yet for task type "${taskType}".`
        : 'No council history yet. Run `buddy council "<task>"` a few times.';
    }
    const header = taskType
      ? `Learned model ranking for "${taskType}" tasks:`
      : 'Learned model ranking (all task types):';
    const lines = rows.map((s, i) => {
      const wr = `${Math.round(s.winRate * 100)}%`;
      const q = s.avgQuality.toFixed(2);
      const lat = `${Math.round(s.avgLatencyMs)}ms`;
      const cost = s.avgCostUsd === 0 ? '$0' : `$${s.avgCostUsd.toFixed(4)}`;
      return `  ${i + 1}. ${s.model.padEnd(22)} win ${wr.padStart(4)} (${s.wins}/${s.runs})  q${q}  ${lat}  ${cost}`;
    });
    return [header, ...lines].join('\n');
  }
}

let singleton: ModelScoreboard | null = null;

export function getModelScoreboard(): ModelScoreboard {
  if (!singleton) singleton = new ModelScoreboard();
  return singleton;
}

/** Test seam — reset the cached singleton. */
export function resetModelScoreboard(): void {
  singleton = null;
}
