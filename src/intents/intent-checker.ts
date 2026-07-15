/** Deterministic criterion replay and code-to-intent drift detection. */

import { access } from 'node:fs/promises';
import path from 'node:path';
import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { logger } from '../utils/logger.js';
import type { Intent, IntentCriterion, IntentStore } from './intent-store.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const TAIL_LENGTH = 2_000;

export interface CriterionCheckResult {
  criterion: IntentCriterion;
  ok: boolean;
  exitCode: number | null;
  tail: string;
  timedOut: boolean;
}

export interface IntentCheckResult {
  intentId: string;
  results: CriterionCheckResult[];
  ok: boolean;
}

export interface CheckIntentOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Injectable child_process seam. Defaults to node:child_process.spawn. */
  spawn?: typeof nodeSpawn;
  /** When supplied, the completed check is appended to the store ledger. */
  store?: IntentStore;
}

export interface IntentDrift {
  id: string;
  title: string;
  intent: Intent;
  missingFiles: string[];
  failedCriteria: CriterionCheckResult[];
  reasons: string[];
}

export type DriftOptions = Omit<CheckIntentOptions, 'cwd' | 'store'>;

function resolveTimeout(explicit?: number): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  const fromEnv = Number(process.env.CODEBUDDY_INTENTS_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? Math.floor(fromEnv) : DEFAULT_TIMEOUT_MS;
}

function appendTail(current: string, chunk: string | Buffer): string {
  return `${current}${chunk.toString()}`.slice(-TAIL_LENGTH);
}

function forbiddenCommandReason(command: string): string | null {
  if (/(^|[\s;&|])sudo(?:\s|$)/.test(command)) {
    return 'Criterion refused: sudo is not allowed.';
  }
  return null;
}

async function runCriterion(
  criterion: IntentCriterion,
  cwd: string,
  timeoutMs: number,
  spawnProcess: typeof nodeSpawn,
): Promise<CriterionCheckResult> {
  const forbidden = forbiddenCommandReason(criterion.cmd);
  if (forbidden) {
    return { criterion, ok: false, exitCode: null, tail: forbidden, timedOut: false };
  }

  return new Promise((resolve) => {
    let tail = '';
    let settled = false;
    let timedOut = false;
    const options: SpawnOptions = {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    };
    let child: ReturnType<typeof nodeSpawn>;
    try {
      child = spawnProcess('sh', ['-c', criterion.cmd], options);
    } catch (error) {
      resolve({
        criterion,
        ok: false,
        exitCode: null,
        tail: `Unable to start criterion: ${error instanceof Error ? error.message : String(error)}`,
        timedOut: false,
      });
      return;
    }

    child.stdout?.on('data', (chunk: string | Buffer) => {
      tail = appendTail(tail, chunk);
    });
    child.stderr?.on('data', (chunk: string | Buffer) => {
      tail = appendTail(tail, chunk);
    });

    const finish = (exitCode: number | null, extra = ''): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const renderedTail = `${tail}${extra}`.slice(-TAIL_LENGTH);
      resolve({
        criterion,
        ok: !timedOut && exitCode === criterion.expectExit,
        exitCode,
        tail: renderedTail,
        timedOut,
      });
    };

    child.once('error', (error) => finish(null, `\nUnable to run criterion: ${error.message}`));
    child.once('close', (code, signal) =>
      finish(code, signal ? `\nProcess ended by signal ${signal}.` : ''),
    );

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      finish(null, `\nCriterion timed out after ${timeoutMs}ms.`);
    }, timeoutMs);
  });
}

async function recordCheck(store: IntentStore | undefined, result: IntentCheckResult): Promise<void> {
  if (!store) return;
  try {
    await store.recordChecked(result.intentId, {
      ok: result.ok,
      criteria: result.results.map((entry) => ({
        desc: entry.criterion.desc,
        ok: entry.ok,
        exitCode: entry.exitCode,
        timedOut: entry.timedOut,
      })),
    });
  } catch (error) {
    logger.warn('[intents] Unable to append checked event to the intent ledger.', { error: String(error) });
  }
}

export async function checkIntent(intent: Intent, options: CheckIntentOptions = {}): Promise<IntentCheckResult> {
  const cwd = path.resolve(options.cwd ?? options.store?.rootDir ?? process.cwd());
  const timeoutMs = resolveTimeout(options.timeoutMs);
  const spawnProcess = options.spawn ?? nodeSpawn;
  const results: CriterionCheckResult[] = [];
  for (const criterion of intent.criteria) {
    results.push(await runCriterion(criterion, cwd, timeoutMs, spawnProcess));
  }
  // An intent without criteria provides no proof, so the gate fails closed.
  const result: IntentCheckResult = {
    intentId: intent.id,
    results,
    ok: results.length > 0 && results.every((entry) => entry.ok),
  };
  await recordCheck(options.store, result);
  return result;
}

function isInsideRoot(rootDir: string, candidate: string): boolean {
  const relative = path.relative(rootDir, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function findMissingFiles(intent: Intent, rootDir: string): Promise<string[]> {
  const missing: string[] = [];
  for (const file of intent.files) {
    const resolved = path.resolve(rootDir, file);
    if (!isInsideRoot(rootDir, resolved)) {
      missing.push(file);
      continue;
    }
    try {
      await access(resolved);
    } catch {
      missing.push(file);
    }
  }
  return missing;
}

export async function drift(store: IntentStore, options: DriftOptions = {}): Promise<IntentDrift[]> {
  const intents = await store.list();
  const drifted: IntentDrift[] = [];
  for (const intent of intents) {
    if (intent.status !== 'done') continue;
    const [missingFiles, check] = await Promise.all([
      findMissingFiles(intent, store.rootDir),
      checkIntent(intent, { ...options, cwd: store.rootDir, store }),
    ]);
    const failedCriteria = check.results.filter((entry) => !entry.ok);
    if (missingFiles.length === 0 && failedCriteria.length === 0) continue;
    const reasons = [
      ...missingFiles.map((file) => `Referenced file is missing or outside the repository: ${file}`),
      ...failedCriteria.map((entry) => `Criterion failed: ${entry.criterion.desc}`),
    ];
    const entry: IntentDrift = {
      id: intent.id,
      title: intent.title,
      intent,
      missingFiles,
      failedCriteria,
      reasons,
    };
    drifted.push(entry);
    try {
      await store.recordDrifted(intent.id, {
        missingFiles,
        failedCriteria: failedCriteria.map((result) => result.criterion.desc),
      });
    } catch (error) {
      logger.warn('[intents] Unable to append drifted event to the intent ledger.', { error: String(error) });
    }
  }
  return drifted;
}
