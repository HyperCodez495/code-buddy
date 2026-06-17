/**
 * disk-guard — the single place that bounds disk access.
 *
 * Motivation: on 2026-06-17 a tight build/Electron restart loop leaked temp
 * dirs until the disk filled mid-run, corrupting command-output capture
 * (ENOSPC). The fix at the time guarded ONE call site (the Cowork pilot). This
 * module generalizes that lesson into reusable primitives so the failure class
 * — "unbounded resource accumulation in a tight loop without monitoring or
 * cleanup" — is handled in one place:
 *
 *   - free-space preflight   → {@link getFreeSpaceInfo}, {@link ensureFreeSpace}
 *   - managed temp lifecycle → {@link createManagedTempDir} (auto-cleaned on exit)
 *   - orphan sweep backstop  → {@link sweepOrphans} (catches SIGKILL'd leaks)
 *   - byte budget            → {@link DiskBudget}
 *   - bounded writes / logs  → {@link boundedWriteFile}, {@link boundedAppendFile},
 *                              {@link rotateIfLarge}
 *
 * Scope is deliberately focused. It is adopted at the highest-risk sites
 * (disk-space checks, leaky /tmp dirs, unbounded append logs) rather than
 * routing every fs write through it. It deliberately does NOT bound:
 *   - general / user-intentional workspace writes (the user asked for them),
 *   - third-party writers (Electron / Docker / Playwright) — covered instead by
 *     the startup {@link sweepOrphans} backstop,
 *   - low-traffic logs (add a one-line {@link rotateIfLarge} as needed).
 *
 * Config (read from the environment at call time, validated, with fallbacks —
 * see {@link DISK_GUARD_DEFAULTS}; registered in `src/config/env-schema.ts`):
 *   CODEBUDDY_MIN_FREE_MB, CODEBUDDY_DISK_QUOTA_MB, CODEBUDDY_TEMP_MAX_AGE_MS,
 *   CODEBUDDY_LOG_MAX_MB, CODEBUDDY_LOG_MAX_FILES.
 */

import {
  statfsSync,
  readdirSync,
  statSync,
  existsSync,
  renameSync,
  unlinkSync,
  rmSync,
  type StatsFs,
} from 'node:fs';
import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, extname } from 'node:path';

import { logger } from './logger.js';
import { CodeBuddyError } from '../errors/base-error.js';
import { registerDisposable, unregisterDisposable, type Disposable } from './disposable.js';
import { GracefulShutdownManager } from './graceful-shutdown.js';

const MB = 1024 * 1024;

/** Built-in fallbacks, used when the matching env var is unset/invalid. */
export const DISK_GUARD_DEFAULTS = {
  /** Min free space (MB) before a guarded write/launch is refused. Matches the pilot's 500MB. */
  minFreeMb: 500,
  /** Per-session byte budget (MB); 0 = unlimited. */
  quotaMb: 0,
  /** Orphan-sweep age cutoff (ms); 0 = presence-based (remove any match). */
  tempMaxAgeMs: 0,
  /** Append-log rotation size (MB). Matches logger.ts. */
  logMaxMb: 10,
  /** Append-log retention count. Matches logger.ts. */
  logMaxFiles: 5,
} as const;

/** Parse a non-negative integer env var with range validation + fallback (mirrors AutoCompactConfig.fromEnv). */
function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw !== undefined && raw !== '') {
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed) && parsed >= min && parsed <= max) {
      return parsed;
    }
  }
  return fallback;
}

function defaultMinFreeBytes(): number {
  return readIntEnv('CODEBUDDY_MIN_FREE_MB', DISK_GUARD_DEFAULTS.minFreeMb, 0, 1_000_000) * MB;
}
function defaultQuotaBytes(): number {
  return readIntEnv('CODEBUDDY_DISK_QUOTA_MB', DISK_GUARD_DEFAULTS.quotaMb, 0, 100_000_000) * MB;
}
function defaultTempMaxAgeMs(): number {
  return readIntEnv('CODEBUDDY_TEMP_MAX_AGE_MS', DISK_GUARD_DEFAULTS.tempMaxAgeMs, 0, Number.MAX_SAFE_INTEGER);
}
function defaultLogMaxBytes(): number {
  return readIntEnv('CODEBUDDY_LOG_MAX_MB', DISK_GUARD_DEFAULTS.logMaxMb, 1, 100_000) * MB;
}
function defaultLogMaxFiles(): number {
  return readIntEnv('CODEBUDDY_LOG_MAX_FILES', DISK_GUARD_DEFAULTS.logMaxFiles, 1, 1000);
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / MB)}MB`;
}

function byteLength(data: string | Uint8Array): number {
  return typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown by {@link ensureFreeSpace} when free disk space is below the threshold. */
export class DiskSpaceError extends CodeBuddyError {
  constructor(message: string, context: { path: string; freeBytes: number; minBytes: number }) {
    super('DISK_SPACE_LOW', message, { context });
    this.name = 'DiskSpaceError';
  }
}

/** Thrown by {@link boundedWriteFile} when a {@link DiskBudget} reservation is refused. */
export class DiskBudgetError extends CodeBuddyError {
  constructor(message: string, context: { usedBytes: number; quotaBytes: number; requestedBytes: number }) {
    super('DISK_BUDGET_EXCEEDED', message, { context });
    this.name = 'DiskBudgetError';
  }
}

// ---------------------------------------------------------------------------
// Free space
// ---------------------------------------------------------------------------

export interface FreeSpaceInfo {
  freeBytes: number;
  totalBytes: number;
  freePercent: number;
}

/**
 * Free-space info for the filesystem containing `targetPath`, or `null` when
 * `fs.statfsSync` is unavailable / the path can't be stat'd (never throws).
 * Uses `bavail` (blocks available to non-root) — the honest free figure a
 * normal process can actually use — not `bfree`.
 */
export function getFreeSpaceInfo(targetPath: string): FreeSpaceInfo | null {
  try {
    const st = statfsSync(targetPath) as StatsFs;
    const bsize = Number(st.bsize);
    const totalBytes = Number(st.blocks) * bsize;
    const freeBytes = Number(st.bavail) * bsize;
    const freePercent = totalBytes > 0 ? (freeBytes / totalBytes) * 100 : 0;
    return { freeBytes, totalBytes, freePercent };
  } catch {
    return null;
  }
}

/** Free bytes for the filesystem containing `targetPath`, or `null` if unavailable. */
export function getFreeBytes(targetPath: string): number | null {
  return getFreeSpaceInfo(targetPath)?.freeBytes ?? null;
}

/**
 * Throw {@link DiskSpaceError} if free space on `targetPath`'s filesystem is
 * below `minBytes` (default {@link DISK_GUARD_DEFAULTS.minFreeMb}). No-op when
 * statfs is unavailable — we can't guard, so we don't block (matches the
 * platform-resilient behavior of the original pilot guard).
 */
export function ensureFreeSpace(targetPath: string, minBytes?: number, opts: { label?: string } = {}): void {
  const min = minBytes ?? defaultMinFreeBytes();
  const info = getFreeSpaceInfo(targetPath);
  if (info === null) return;
  if (info.freeBytes < min) {
    const label = opts.label ? `${opts.label}: ` : '';
    throw new DiskSpaceError(
      `${label}only ${formatMb(info.freeBytes)} free on ${targetPath} — refusing to proceed ` +
        `(needs ${formatMb(min)} headroom; free disk space first).`,
      { path: targetPath, freeBytes: info.freeBytes, minBytes: min },
    );
  }
}

// ---------------------------------------------------------------------------
// Orphan sweep
// ---------------------------------------------------------------------------

export interface SweepResult {
  removed: string[];
  skipped: string[];
}

/**
 * Remove orphaned entries named `<prefix>*` directly under `root`. This is the
 * durable backstop for the leak class: managed temp dirs are auto-disposed on a
 * graceful exit, but a SIGKILL'd / crashed run skips cleanup and leaks its dir
 * until the next startup sweep.
 *
 * - `maxAgeMs: 0` (default) → presence-based: remove every match (the original
 *   pilot semantics — safe when only one instance runs at a time).
 * - `maxAgeMs > 0` → age-safe: only remove matches whose mtime is older than
 *   `maxAgeMs`, so a concurrently-running peer's fresh dir is never nuked.
 */
export function sweepOrphans(
  root: string,
  prefix: string,
  opts: { maxAgeMs?: number; dryRun?: boolean } = {},
): SweepResult {
  const maxAgeMs = opts.maxAgeMs ?? defaultTempMaxAgeMs();
  const dryRun = opts.dryRun ?? false;
  const removed: string[] = [];
  const skipped: string[] = [];

  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return { removed, skipped };
  }

  const now = Date.now();
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const full = join(root, name);

    if (maxAgeMs > 0) {
      try {
        const st = statSync(full);
        if (now - st.mtimeMs < maxAgeMs) {
          skipped.push(full);
          continue;
        }
      } catch {
        skipped.push(full);
        continue;
      }
    }

    if (dryRun) {
      removed.push(full);
      continue;
    }
    try {
      rmSync(full, { recursive: true, force: true });
      removed.push(full);
    } catch {
      skipped.push(full);
    }
  }

  return { removed, skipped };
}

/**
 * One-shot startup janitor: remove our own stale scratch dirs/files left in the
 * system temp dir by crashed or SIGKILL'd runs (the durable backstop for the
 * leak class). Age-gated (default 24h) so a concurrently-running session's fresh
 * scratch dirs are never touched. Matches both `codebuddy-*` and `codebuddy_*`.
 * Never throws.
 */
export function sweepStaleCodebuddyTemp(maxAgeMs = 24 * 60 * 60 * 1000): SweepResult {
  return sweepOrphans(tmpdir(), 'codebuddy', { maxAgeMs });
}

// ---------------------------------------------------------------------------
// Managed temp lifecycle
// ---------------------------------------------------------------------------

export interface ManagedTempDir extends Disposable {
  /** Absolute path of the created temp directory. */
  readonly path: string;
  /** Remove the directory and untrack it. Idempotent. */
  dispose(): Promise<void>;
}

const managedTempDirs = new Set<ManagedTempDirImpl>();
let shutdownHandlerRegistered = false;

class ManagedTempDirImpl implements ManagedTempDir {
  readonly path: string;
  private disposed = false;

  constructor(path: string) {
    this.path = path;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    managedTempDirs.delete(this);
    unregisterDisposable(this);
    try {
      await rm(this.path, { recursive: true, force: true });
    } catch (err) {
      logger.warn(`disk-guard: failed to remove managed temp dir ${this.path}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** Lazily wire a single shutdown handler the first time a managed temp dir is created. */
function ensureShutdownHandler(): void {
  if (shutdownHandlerRegistered) return;
  shutdownHandlerRegistered = true;
  try {
    GracefulShutdownManager.getInstance().registerHandler({
      name: 'disk-guard:temp-cleanup',
      priority: 100,
      handler: async () => {
        await disposeAllManagedTempDirs();
      },
    });
  } catch (err) {
    logger.debug('disk-guard: could not register shutdown handler', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Dispose every still-tracked managed temp dir (invoked on graceful shutdown). */
export async function disposeAllManagedTempDirs(): Promise<void> {
  await Promise.allSettled([...managedTempDirs].map((d) => d.dispose()));
}

/**
 * Create a temp directory that is tracked and auto-removed on graceful exit
 * (and via the {@link Disposable} registry). Preflights {@link ensureFreeSpace}
 * on the parent so we fail fast instead of mkdtemp'ing into a full disk.
 *
 * Pair this with a startup {@link sweepOrphans} on the same `parentDir`/`prefix`
 * as the durable backstop for crashed runs that never reach `dispose()`.
 */
export async function createManagedTempDir(
  prefix: string,
  opts: { parentDir?: string; minFreeBytes?: number } = {},
): Promise<ManagedTempDir> {
  const parent = opts.parentDir ?? tmpdir();
  ensureFreeSpace(parent, opts.minFreeBytes, { label: `createManagedTempDir(${prefix})` });
  const dir = await mkdtemp(join(parent, prefix));
  const handle = new ManagedTempDirImpl(dir);
  managedTempDirs.add(handle);
  registerDisposable(handle);
  ensureShutdownHandler();
  return handle;
}

// ---------------------------------------------------------------------------
// Byte budget
// ---------------------------------------------------------------------------

export interface BudgetReservation {
  allowed: boolean;
  reason?: string;
}

/**
 * Tracks cumulative bytes written against a quota
 * (default {@link DISK_GUARD_DEFAULTS.quotaMb} → `CODEBUDDY_DISK_QUOTA_MB`).
 * A quota of 0 means unlimited — every reservation is allowed.
 */
export class DiskBudget {
  private readonly quotaBytes: number;
  private usedBytes = 0;

  constructor(quotaBytes?: number) {
    this.quotaBytes = quotaBytes ?? defaultQuotaBytes();
  }

  /** Check (without recording) whether `bytes` more would fit. */
  reserve(bytes: number): BudgetReservation {
    if (this.quotaBytes <= 0) return { allowed: true };
    if (this.usedBytes + bytes > this.quotaBytes) {
      return {
        allowed: false,
        reason:
          `disk budget exceeded: ${formatMb(this.usedBytes + bytes)} would exceed ` +
          `quota ${formatMb(this.quotaBytes)}`,
      };
    }
    return { allowed: true };
  }

  record(bytes: number): void {
    this.usedBytes += bytes;
  }

  release(bytes: number): void {
    this.usedBytes = Math.max(0, this.usedBytes - bytes);
  }

  used(): number {
    return this.usedBytes;
  }

  remaining(): number {
    return this.quotaBytes <= 0 ? Infinity : Math.max(0, this.quotaBytes - this.usedBytes);
  }
}

// ---------------------------------------------------------------------------
// Bounded writes + log rotation
// ---------------------------------------------------------------------------

function rotatedPath(filePath: string, index: number): string {
  const ext = extname(filePath);
  const base = filePath.slice(0, filePath.length - ext.length);
  return `${base}.${index}${ext}`;
}

/**
 * Rotate `filePath` when it reaches `maxBytes`, keeping at most `maxFiles`
 * generations (`name.1.ext` … `name.N.ext`, oldest dropped). Ports the
 * algorithm in logger.ts so unbounded append logs can't fill the disk.
 * Returns true if a rotation happened. Never throws.
 */
export function rotateIfLarge(filePath: string, maxBytes?: number, maxFiles?: number): boolean {
  const max = maxBytes ?? defaultLogMaxBytes();
  const keep = maxFiles ?? defaultLogMaxFiles();

  try {
    const st = statSync(filePath);
    if (st.size < max) return false;
  } catch {
    return false; // file doesn't exist yet → nothing to rotate
  }

  // Shift existing rotated files (N -> N+1), dropping anything beyond `keep`.
  for (let i = keep - 1; i >= 1; i--) {
    const src = rotatedPath(filePath, i);
    const dst = rotatedPath(filePath, i + 1);
    try {
      if (existsSync(src)) {
        if (i + 1 > keep) unlinkSync(src);
        else renameSync(src, dst);
      }
    } catch {
      /* ignore individual file rotation errors */
    }
  }

  try {
    const overflow = rotatedPath(filePath, keep + 1);
    if (existsSync(overflow)) unlinkSync(overflow);
  } catch {
    /* ignore */
  }

  try {
    renameSync(filePath, rotatedPath(filePath, 1));
  } catch {
    /* if rename fails, continue appending to the existing file */
  }

  return true;
}

/**
 * Write a file after preflighting free space (and, if a {@link DiskBudget} is
 * supplied, reserving + recording its size). Throws {@link DiskSpaceError} or
 * {@link DiskBudgetError} before touching disk when bounds would be breached.
 */
export async function boundedWriteFile(
  filePath: string,
  data: string | Uint8Array,
  opts: { minFreeBytes?: number; budget?: DiskBudget } = {},
): Promise<void> {
  ensureFreeSpace(dirname(filePath), opts.minFreeBytes, { label: `write ${basename(filePath)}` });
  const size = byteLength(data);
  if (opts.budget) {
    const res = opts.budget.reserve(size);
    if (!res.allowed) {
      throw new DiskBudgetError(res.reason ?? 'disk budget exceeded', {
        usedBytes: opts.budget.used(),
        quotaBytes: opts.budget.used() + opts.budget.remaining(),
        requestedBytes: size,
      });
    }
  }
  await writeFile(filePath, data);
  opts.budget?.record(size);
}

/**
 * Append to a file after optionally rotating it ({@link rotateIfLarge}) and
 * preflighting free space. The append-log counterpart to {@link boundedWriteFile}.
 */
export async function boundedAppendFile(
  filePath: string,
  data: string | Uint8Array,
  opts: { minFreeBytes?: number; rotate?: { maxBytes?: number; maxFiles?: number } } = {},
): Promise<void> {
  if (opts.rotate) {
    rotateIfLarge(filePath, opts.rotate.maxBytes, opts.rotate.maxFiles);
  }
  ensureFreeSpace(dirname(filePath), opts.minFreeBytes, { label: `append ${basename(filePath)}` });
  await appendFile(filePath, data);
}

/** Test helper: clear tracked temp dirs + reset the lazy shutdown-handler flag. */
export function resetDiskGuardForTests(): void {
  managedTempDirs.clear();
  shutdownHandlerRegistered = false;
}
