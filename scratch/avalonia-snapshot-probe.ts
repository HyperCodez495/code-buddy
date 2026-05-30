// Probe: validate desktop piloting on a REAL Avalonia app (Skia-rendered, UIA peers only).
// Key test = select an off-screen virtualized list item ("Item 250"), which exercises P0d's
// universal scroll-and-rewalk fallback when ItemContainerPattern isn't available.
// Run: npx tsx scratch/avalonia-snapshot-probe.ts
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ComputerControlTool, type ComputerControlInput } from '../src/tools/computer-control-tool.js';
import { getSmartSnapshotManager } from '../src/desktop-automation/smart-snapshot.js';

const scratch = path.join(process.cwd(), 'scratch');
const exe = path.join(scratch, 'avalonia-fixture', 'bin', 'Debug', 'net10.0', 'AvaloniaFixture.exe');
const statePath = path.join(scratch, 'avalonia-fixture-state.json');
const title = 'CodeBuddy Avalonia Fixture';
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readState(): Promise<Record<string, unknown> | null> {
  try { return JSON.parse((await fs.readFile(statePath, 'utf8')).replace(/^\uFEFF/, '')); } catch { return null; }
}
async function waitReady(timeout = 30_000): Promise<void> {
  const s = Date.now();
  while (Date.now() - s < timeout) { const j = await readState(); if (j?.ready && j.status === 'ready') return; await delay(150); }
  throw new Error('avalonia fixture not ready');
}

let child: ReturnType<typeof spawn> | null = null;
try {
  await fs.rm(statePath, { force: true });
  child = spawn(exe, [], { env: { ...process.env, CB_FIXTURE_STATE: statePath }, detached: true, stdio: 'ignore' });
  child.unref();
  await waitReady();

  const tool = new ComputerControlTool();
  await tool.execute({ action: 'focus_window', windowTitle: title, windowTitleMatch: 'contains' } as ComputerControlInput);
  await delay(600);

  let snapInfo: Record<string, unknown> = {};
  try {
    const snap = await getSmartSnapshotManager().takeSnapshot({ interactiveOnly: false });
    snapInfo = {
      elements: snap.elements.length,
      automationIdPopulated: snap.elements.filter((e) => e.automationId).length,
      sampleIds: snap.elements.map((e) => e.automationId).filter(Boolean).slice(0, 10),
      classNames: [...new Set(snap.elements.map((e) => e.className).filter(Boolean))].slice(0, 8),
    };
  } catch (e) { snapInfo = { error: String(e) }; }

  const steps: Array<[string, ComputerControlInput]> = [
    ['fill message', { action: 'fill_text_field', name: 'Message', text: 'Bonjour Avalonia', clearFirst: true, exactName: true, windowTitle: title } as ComputerControlInput],
    ['toggle companion', { action: 'toggle_checkbox', name: 'Enable companion mode', checked: true, exactName: true, windowTitle: title } as ComputerControlInput],
    ['select Item 3 (visible, depth-13)', { action: 'select_list_item', name: 'Item 3', exactName: true, windowTitle: title } as ComputerControlInput],
    ['select Item 250 (virtualized)', { action: 'select_list_item', name: 'Item 250', exactName: true, windowTitle: title } as ComputerControlInput],
    ['click Apply', { action: 'click_button', name: 'Apply', exactName: true, windowTitle: title } as ComputerControlInput],
  ];
  const stepResults: Record<string, { success: boolean; info: string }> = {};
  for (const [label, input] of steps) {
    const r = await tool.execute(input);
    stepResults[label] = { success: r.success, info: r.output ?? r.error ?? '' };
    console.log(`[${r.success ? 'ok' : 'fail'}] ${label}: ${r.output ?? r.error ?? ''}`);
    await delay(450);
  }

  await delay(300);
  const finalState = await readState();
  const summary = {
    snapshot: snapInfo,
    steps: stepResults,
    finalState,
    assertions: {
      messageTyped: finalState?.message === 'Bonjour Avalonia',
      companionEnabled: finalState?.companionEnabled === true,
      virtualizedItemSelected: finalState?.bigItem === 'Item 250',
      applyClicked: ((finalState?.appliedCount as number) ?? 0) >= 1,
    },
  };
  console.log('--- AVALONIA SUMMARY ---');
  console.log(JSON.stringify(summary, null, 2));
  await fs.writeFile(path.join(scratch, 'avalonia-snapshot-probe-result.json'), JSON.stringify(summary, null, 2), 'utf8');
} catch (err) {
  console.error('probe error:', err);
} finally {
  if (child?.pid) spawnSync('powershell.exe', ['-NoProfile', '-Command', `Stop-Process -Id ${child.pid} -Force -ErrorAction SilentlyContinue`]);
}
