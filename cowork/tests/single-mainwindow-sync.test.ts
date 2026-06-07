/**
 * Regression guard for the rc.8 dual-`mainWindow` bug (CLAUDE.md, commit 751f7eb6).
 *
 * `cowork/src/main/index.ts` and `window-management.ts` each owned a separate
 * `let mainWindow`. Only the former was set, so `getMainWindow()` (used by
 * `ipc-main-bridge.ts:sendToRenderer()`) always returned `null` and SILENTLY
 * dropped every main→renderer IPC push. The fix: whoever creates the main
 * `BrowserWindow` must sync the shared reference via `setMainWindow()`.
 *
 * This static guard fails if any main-process module creates the main window
 * (`mainWindow = new BrowserWindow(...)`) without calling `setMainWindow(...)`
 * in the same file — catching a re-introduction of the bug at test time rather
 * than as a silent runtime IPC blackout.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';

const mainDir = fileURLToPath(new URL('../src/main', import.meta.url));

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...tsFiles(p));
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

describe('single mainWindow sync (rc.8 regression guard)', () => {
  it('every module that creates the main BrowserWindow also calls setMainWindow()', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(mainDir)) {
      // window-management.ts is the canonical owner of the shared reference
      // (its assignment IS the source of truth that getMainWindow() reads).
      if (file.endsWith('window-management.ts')) continue;

      const src = readFileSync(file, 'utf-8');
      const createsMainWindow = /mainWindow\s*=\s*new\s+BrowserWindow/.test(src);
      const syncsSharedRef = /setMainWindow\s*\(/.test(src);
      if (createsMainWindow && !syncsSharedRef) {
        offenders.push(file.slice(mainDir.length + 1));
      }
    }

    expect(
      offenders,
      `These main-process modules create the main BrowserWindow but never call ` +
        `setMainWindow(win) — that silently breaks main→renderer IPC ` +
        `(rc.8 dual-mainWindow bug). Call setMainWindow(win) right after creating it.`,
    ).toEqual([]);
  });
});
