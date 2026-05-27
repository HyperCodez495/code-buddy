// Probe: validate P0a (automationId/controlType/runtimeId extraction) on a REAL WPF window,
// and demonstrate the virtualization gap (visible item present, off-screen item absent).
// Run: npx tsx scratch/wpf-snapshot-probe.ts
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ComputerControlTool, type ComputerControlInput } from '../src/tools/computer-control-tool.js';
import { getSmartSnapshotManager } from '../src/desktop-automation/smart-snapshot.js';

const scratch = path.join(process.cwd(), 'scratch');
const fixture = path.join(scratch, 'computer-use-wpf-fixture.ps1');
const launcher = path.join(scratch, 'start-computer-use-fixture.ps1');
const statePath = path.join(scratch, 'computer-use-wpf-state.json');
const title = 'CodeBuddy WPF Fixture';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function launch(): number {
  const r = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher,
    '-FixturePath', fixture, '-StatePath', statePath,
  ], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`launch failed: ${r.stderr || r.stdout}`);
  const pid = Number(r.stdout.trim());
  if (!Number.isFinite(pid) || pid <= 0) throw new Error(`bad pid: ${r.stdout}`);
  return pid;
}

function kill(pid: number): void {
  spawnSync('powershell.exe', ['-NoProfile', '-Command', `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`]);
}

async function waitReady(timeout = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const j = JSON.parse((await fs.readFile(statePath, 'utf8')).replace(/^﻿/, ''));
      if (j.ready && j.status === 'ready') return;
    } catch { /* not ready yet */ }
    await delay(150);
  }
  throw new Error('fixture not ready');
}

let pid = 0;
try {
  await fs.rm(statePath, { force: true });
  pid = launch();
  await waitReady();

  const tool = new ComputerControlTool();
  await tool.execute({ action: 'focus_window', windowTitle: title, windowTitleMatch: 'contains' } as ComputerControlInput);
  await delay(400);
  // Click inside the window so a child element holds focus (snapshot walks from FocusedElement).
  await tool.execute({ action: 'click', x: 220, y: 150 } as ComputerControlInput);
  await delay(400);

  const snap = await getSmartSnapshotManager().takeSnapshot({ interactiveOnly: false });
  const els = snap.elements;
  console.log(`SNAPSHOT elements=${els.length} source=${snap.source}`);

  const withId = els.filter((e) => e.automationId);
  console.log(`automationId populated on ${withId.length}/${els.length} elements`);
  console.log('--- sample (first 16) ---');
  for (const e of els.slice(0, 16)) {
    console.log(`  [${e.ref}] role=${e.role} name="${e.name}" id=${e.automationId ?? '-'} ct=${e.controlType ?? '-'} rt=${e.runtimeId ?? '-'}`);
  }

  const names = new Set(els.map((e) => e.name));

  // P0d: select an OFF-SCREEN virtualized item by name. Before P0d this fails
  // ("No semantic target 'Item 250'"); after P0d the item is realized + scrolled into view.
  const sel = await tool.execute({ action: 'select_list_item', name: 'Item 250', exactName: true, windowTitle: title, windowTitleMatch: 'contains' } as ComputerControlInput);
  console.log(`select_list_item "Item 250": success=${sel.success} :: ${sel.output ?? sel.error ?? ''}`);
  await delay(500);
  let bigItemAfter = '';
  try { bigItemAfter = JSON.parse((await fs.readFile(statePath, 'utf8')).replace(/^﻿/, '')).bigItem ?? ''; } catch { /* ignore */ }

  const summary = {
    elements: els.length,
    automationIdPopulated: withId.length,
    runtimeIdPopulated: els.filter((e) => e.runtimeId).length,
    controlTypePopulated: els.filter((e) => e.controlType).length,
    hasMessageById: els.some((e) => e.automationId === 'Message'),
    hasBigListById: els.some((e) => e.automationId === 'BigList'),
    hasItem1_visible: names.has('Item 1'),
    hasItem250_offscreen_in_snapshot: names.has('Item 250'),
    selectItem250_success: sel.success,
    bigItem_after_select: bigItemAfter,
  };
  console.log('--- VIRTUALIZATION GAP CHECK ---');
  console.log(JSON.stringify(summary, null, 2));
  await fs.writeFile(path.join(scratch, 'wpf-snapshot-probe-result.json'), JSON.stringify({ summary, elements: els }, null, 2), 'utf8');
} catch (err) {
  console.error('probe error:', err);
} finally {
  if (pid) kill(pid);
}
