#!/usr/bin/env node
/**
 * Remove *.js.map source maps from dist/ before packing/publishing.
 *
 * Source maps are ~18MB (≈36% of the npm tarball) and have zero value for a
 * CLI end-user. They are kept in local `npm run build` output for debugging and
 * only stripped at pack/publish time (wired via the `prepack` script).
 *
 * We intentionally keep *.d.ts declarations — the package exposes `types` via
 * the `exports` map (plugin-sdk, desktop, engine-types), so consumers need them.
 *
 * Cross-platform (pure Node, no glob deps) so `npm pack` works on Windows too.
 */
import { readdir, stat, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

let removed = 0;
let freedBytes = 0;

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // dist/ may not exist (e.g. fresh clone, no build yet) — nothing to strip
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.js.map')) {
      try {
        const { size } = await stat(full);
        await unlink(full);
        removed += 1;
        freedBytes += size;
      } catch {
        // best-effort: ignore individual file errors
      }
    }
  }
}

await walk(distDir);
const freedMb = (freedBytes / 1048576).toFixed(1);
console.log(`[strip-sourcemaps] removed ${removed} *.js.map file(s), freed ${freedMb} MB from dist/`);
