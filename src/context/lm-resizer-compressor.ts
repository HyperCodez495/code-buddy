/**
 * lm-resizer compressor — pipes a noisy tool output through Patrice's Rust `lm-resizer`
 * (Apache-2.0, $0) to shrink it before it reaches the LLM, preserving the real signal
 * (errors, paths, summaries) and dropping repeated/low-value lines. The full original stays
 * recoverable (lm-resizer persists it in its CCR store; Code Buddy also keeps it via
 * `persistToolResult`).
 *
 * Wraps the `lm-resizer compress --json` subcommand. NEVER-THROWS: returns `null` when the
 * binary is missing, errors, or times out, so the caller falls back to the built-in truncation
 * (zero behaviour change when lm-resizer isn't installed/enabled).
 *
 * @module context/lm-resizer-compressor
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from '../utils/logger.js';

export interface LmResizerResult {
  /** The compressed text to send to the LLM (includes lm-resizer's own recovery footer). */
  compressed: string;
  originalBytes: number;
  compressedBytes: number;
  bytesSaved: number;
  /** CCR hash to `lm-resizer retrieve` the full original, if provided. */
  hash?: string;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Resolve the lm-resizer binary: explicit env → local build → PATH. */
export function resolveLmResizerBin(): string {
  const env = process.env.CODEBUDDY_LM_RESIZER_BIN;
  if (env && existsSync(env)) return env;
  const local = join(homedir(), 'DEV', 'lm-resizer', 'target', 'release', 'lm-resizer');
  if (existsSync(local)) return local;
  return 'lm-resizer'; // PATH — if absent, spawn 'error' → null (graceful)
}

function storePath(): string {
  return process.env.CODEBUDDY_LM_RESIZER_STORE || join(homedir(), '.codebuddy', 'lm-resizer.db');
}

/** True when the integration is opt-in enabled. */
export function isLmResizerEnabled(): boolean {
  return process.env.CODEBUDDY_LM_RESIZER === 'true';
}

/**
 * Compress `text` via `lm-resizer compress --json`. `query` (the current user message) biases
 * relevance-aware compression. Never-throws → `null` on any failure (caller falls back).
 */
export async function compressWithLmResizer(
  text: string,
  query = '',
  opts: { timeoutMs?: number; bin?: string } = {},
): Promise<LmResizerResult | null> {
  const bin = opts.bin ?? resolveLmResizerBin();
  const args = ['compress', '--json', '--store', storePath()];
  if (query.trim()) args.push('-q', query.trim().slice(0, 400));

  return new Promise<LmResizerResult | null>((resolve) => {
    let settled = false;
    const finish = (r: LmResizerResult | null): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    let child;
    try {
      child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (err) {
      logger.debug(`[lm-resizer] spawn failed: ${msg(err)}`);
      return finish(null);
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      logger.debug('[lm-resizer] timed out');
      finish(null);
    }, opts.timeoutMs ?? 15_000);

    let out = '';
    child.stdout?.on('data', (d) => {
      out += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      logger.debug(`[lm-resizer] error: ${msg(err)}`);
      finish(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || !out.trim()) return finish(null);
      try {
        const j = JSON.parse(out) as {
          output?: string;
          original_bytes?: number;
          compressed_bytes?: number;
          bytes_saved?: number;
          cache_keys?: string[];
        };
        if (typeof j.output !== 'string' || !j.output) return finish(null);
        finish({
          compressed: j.output,
          originalBytes: j.original_bytes ?? Buffer.byteLength(text),
          compressedBytes: j.compressed_bytes ?? Buffer.byteLength(j.output),
          bytesSaved: j.bytes_saved ?? 0,
          ...(Array.isArray(j.cache_keys) && j.cache_keys[0] ? { hash: j.cache_keys[0] } : {}),
        });
      } catch (err) {
        logger.debug(`[lm-resizer] parse failed: ${msg(err)}`);
        finish(null);
      }
    });

    try {
      child.stdin?.write(text);
      child.stdin?.end();
    } catch (err) {
      clearTimeout(timer);
      logger.debug(`[lm-resizer] stdin write failed: ${msg(err)}`);
      finish(null);
    }
  });
}
