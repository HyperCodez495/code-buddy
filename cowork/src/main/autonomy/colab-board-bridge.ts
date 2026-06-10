/**
 * ColabBoardBridge — the write half of the fleet task board for Cowork.
 *
 * `autonomy.snapshot` made the colab queue observable; this bridge makes it
 * pilotable, mirroring the CLI (`buddy autonomy tasks ...`): add, claim,
 * complete, block, release, plus the expired-claim sweep. Every mutation goes
 * through the core `FleetColabStore` so GUI edits share the protocol
 * invariants (DAG readiness on claim, claim lease, worklog append on
 * completion) instead of forking logic.
 *
 * Claims made here are human-supervised by definition, so `critical` tasks
 * ARE claimable from the GUI — the `isAutoClaimable` guardrail only protects
 * the autonomous daemon's auto-claim path.
 *
 * @module main/autonomy/colab-board-bridge
 */

import os from 'os';
import { loadCoreModule } from '../utils/core-loader';
import { defaultQueueDir } from './autonomy-daemon-bridge';

export type ColabBoardPriority = 'critical' | 'high' | 'medium' | 'low';

const PRIORITIES: ColabBoardPriority[] = ['critical', 'high', 'medium', 'low'];

export interface ColabBoardTaskView {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  claimedBy?: string | null;
  claimedAt?: string | null;
  blockedReason?: string;
  dependsOn?: string[];
  verifyCommand?: string;
}

export interface ColabBoardMutationReview {
  ok: boolean;
  error?: string;
  task?: ColabBoardTaskView;
  dir?: string;
}

export interface ColabBoardReclaimReview {
  ok: boolean;
  error?: string;
  reclaimed: string[];
  dir?: string;
}

export interface ColabBoardAddInput {
  title: string;
  description?: string;
  priority?: ColabBoardPriority;
  dependsOn?: string[];
  verifyCommand?: string;
  acceptanceCriteria?: string[];
  dir?: string;
}

interface CoreColabTask {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  claimedBy?: string | null;
  claimedAt?: string | null;
  blockedReason?: string;
  dependsOn?: string[];
  verifyCommand?: string;
}

interface CoreColabStore {
  getDir(): string;
  addTask(input: {
    title: string;
    description?: string;
    priority?: ColabBoardPriority;
    dependsOn?: string[];
    verifyCommand?: string;
    acceptanceCriteria?: string[];
  }): CoreColabTask;
  claim(taskId: string): CoreColabTask;
  completeTask(taskId: string, input: { summary: string }): { task: CoreColabTask };
  blockTask(taskId: string, reason: string): CoreColabTask;
  releaseTask(taskId: string): CoreColabTask;
  reclaimExpired(): string[];
}

interface CoreColabStoreModule {
  FleetColabStore: new (config: { dir: string; agentId: string }) => CoreColabStore;
}

/** Board mutations from the GUI are attributed to `<host>/cowork`, not the daemon's id. */
function coworkAgentId(): string {
  const host = os.hostname().toLowerCase().split('.')[0] || 'unknown-host';
  return `${host}/cowork`;
}

async function openStore(dir?: string): Promise<{ store: CoreColabStore } | { error: string }> {
  const mod = await loadCoreModule<CoreColabStoreModule>('fleet/colab-store.js');
  if (!mod?.FleetColabStore) {
    return { error: 'Core colab-store module is unavailable (build the core dist first).' };
  }
  return {
    store: new mod.FleetColabStore({ dir: dir?.trim() || defaultQueueDir(), agentId: coworkAgentId() }),
  };
}

function toView(task: CoreColabTask): ColabBoardTaskView {
  return {
    id: task.id,
    title: task.title,
    ...(task.description ? { description: task.description } : {}),
    status: task.status,
    priority: task.priority,
    ...(task.claimedBy !== undefined ? { claimedBy: task.claimedBy } : {}),
    ...(task.claimedAt !== undefined ? { claimedAt: task.claimedAt } : {}),
    ...(task.blockedReason ? { blockedReason: task.blockedReason } : {}),
    ...(task.dependsOn && task.dependsOn.length > 0 ? { dependsOn: task.dependsOn } : {}),
    ...(task.verifyCommand ? { verifyCommand: task.verifyCommand } : {}),
  };
}

function failed(err: unknown): ColabBoardMutationReview {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

export async function addColabTaskForReview(input: ColabBoardAddInput): Promise<ColabBoardMutationReview> {
  const title = input?.title?.trim();
  if (!title) return { ok: false, error: 'A task title is required.' };
  if (input.priority !== undefined && !PRIORITIES.includes(input.priority)) {
    return { ok: false, error: `Invalid priority "${String(input.priority)}" (use critical|high|medium|low).` };
  }
  try {
    const opened = await openStore(input.dir);
    if ('error' in opened) return { ok: false, error: opened.error };
    const task = opened.store.addTask({
      title,
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.dependsOn && input.dependsOn.length > 0 ? { dependsOn: input.dependsOn } : {}),
      ...(input.verifyCommand?.trim() ? { verifyCommand: input.verifyCommand.trim() } : {}),
      ...(input.acceptanceCriteria && input.acceptanceCriteria.length > 0
        ? { acceptanceCriteria: input.acceptanceCriteria }
        : {}),
    });
    return { ok: true, task: toView(task), dir: opened.store.getDir() };
  } catch (err) {
    return failed(err);
  }
}

export async function claimColabTaskForReview(taskId: string, dir?: string): Promise<ColabBoardMutationReview> {
  if (!taskId?.trim()) return { ok: false, error: 'A task id is required.' };
  try {
    const opened = await openStore(dir);
    if ('error' in opened) return { ok: false, error: opened.error };
    return { ok: true, task: toView(opened.store.claim(taskId.trim())), dir: opened.store.getDir() };
  } catch (err) {
    return failed(err);
  }
}

export async function completeColabTaskForReview(
  taskId: string,
  summary: string,
  dir?: string,
): Promise<ColabBoardMutationReview> {
  if (!taskId?.trim()) return { ok: false, error: 'A task id is required.' };
  // The worklog is the fleet's shared memory — a completion without a summary
  // is invisible to the other agents, so it is refused rather than defaulted.
  if (!summary?.trim()) return { ok: false, error: 'A completion summary is required (it feeds the shared worklog).' };
  try {
    const opened = await openStore(dir);
    if ('error' in opened) return { ok: false, error: opened.error };
    const { task } = opened.store.completeTask(taskId.trim(), { summary: summary.trim() });
    return { ok: true, task: toView(task), dir: opened.store.getDir() };
  } catch (err) {
    return failed(err);
  }
}

export async function blockColabTaskForReview(
  taskId: string,
  reason: string,
  dir?: string,
): Promise<ColabBoardMutationReview> {
  if (!taskId?.trim()) return { ok: false, error: 'A task id is required.' };
  if (!reason?.trim()) return { ok: false, error: 'A blocking reason is required (it tells the fleet what to unblock).' };
  try {
    const opened = await openStore(dir);
    if ('error' in opened) return { ok: false, error: opened.error };
    return { ok: true, task: toView(opened.store.blockTask(taskId.trim(), reason.trim())), dir: opened.store.getDir() };
  } catch (err) {
    return failed(err);
  }
}

export async function releaseColabTaskForReview(taskId: string, dir?: string): Promise<ColabBoardMutationReview> {
  if (!taskId?.trim()) return { ok: false, error: 'A task id is required.' };
  try {
    const opened = await openStore(dir);
    if ('error' in opened) return { ok: false, error: opened.error };
    return { ok: true, task: toView(opened.store.releaseTask(taskId.trim())), dir: opened.store.getDir() };
  } catch (err) {
    return failed(err);
  }
}

export async function reclaimExpiredColabForReview(dir?: string): Promise<ColabBoardReclaimReview> {
  try {
    const opened = await openStore(dir);
    if ('error' in opened) return { ok: false, error: opened.error, reclaimed: [] };
    return { ok: true, reclaimed: opened.store.reclaimExpired(), dir: opened.store.getDir() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), reclaimed: [] };
  }
}
