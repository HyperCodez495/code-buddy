import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { ComputerControlTool, type ComputerControlInput } from '../src/tools/computer-control-tool.js';
import { RunStore } from '../src/observability/run-store.js';

interface FixtureState {
  ready?: boolean;
  status?: string;
  message?: string;
  country?: string;
  companionEnabled?: boolean;
  mode?: string;
  activeTab?: string;
  color?: string;
  zoom?: number;
  selectedTreeNode?: string;
  projectsExpanded?: boolean;
  appliedCount?: number;
  timestamp?: string;
}

interface StepEvidence {
  label: string;
  input: ComputerControlInput;
  success: boolean;
  output?: string;
  error?: string;
  data?: unknown;
}

const root = process.cwd();
const scratchDir = path.join(root, 'scratch');
const fixturePath = path.join(scratchDir, 'computer-use-fixture.ps1');
const fixtureLauncherPath = path.join(scratchDir, 'start-computer-use-fixture.ps1');
const statePath = path.join(scratchDir, 'computer-use-real-state.json');
const resultPath = path.join(scratchDir, 'computer-use-real-test-result.json');
const runsDir = path.join(scratchDir, 'computer-use-runs');
const fixtureWindowTitle = 'CodeBuddy Computer Use Fixture';

await fs.rm(statePath, { force: true });
await fs.rm(resultPath, { force: true });
await fs.mkdir(runsDir, { recursive: true });

let fixture: { pid: number; kill: () => void } | null = null;
let store: RunStore | null = null;
const evidence: StepEvidence[] = [];

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readState(): Promise<FixtureState | null> {
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    return JSON.parse(raw.replace(/^\uFEFF/, '')) as FixtureState;
  } catch {
    return null;
  }
}

async function waitForState(
  predicate: (state: FixtureState) => boolean,
  timeoutMs = 10_000,
): Promise<FixtureState> {
  const started = Date.now();
  let lastState: FixtureState | null = null;
  while (Date.now() - started < timeoutMs) {
    const state = await readState();
    lastState = state;
    if (state && predicate(state)) return state;
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for fixture state after ${timeoutMs}ms at ${statePath}; ` +
    `exists=${fsSync.existsSync(statePath)} last=${JSON.stringify(lastState)}`,
  );
}

function summarizeData(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const record = data as Record<string, unknown>;
  return {
    audit: record.audit,
    harness: record.harness ? {
      run: (record.harness as { run?: unknown }).run,
      proof: (record.harness as { proof?: unknown }).proof,
      sensitiveAction: (record.harness as { sensitiveAction?: unknown }).sensitiveAction,
      approval: (record.harness as { approval?: unknown }).approval,
    } : undefined,
    proofArtifactPath: record.proofArtifactPath,
    element: record.element,
    option: record.option,
    source: record.source,
    value: record.value,
    min: record.min,
    max: record.max,
    before: record.before,
    after: record.after,
    textLength: record.textLength,
    changed: record.changed,
  };
}

async function runStep(tool: ComputerControlTool, label: string, input: ComputerControlInput): Promise<void> {
  const result = await tool.execute(input);
  evidence.push({
    label,
    input,
    success: result.success,
    output: result.output,
    error: result.error,
    data: summarizeData(result.data),
  });
  console.log(`[${result.success ? 'ok' : 'fail'}] ${label}: ${result.output ?? result.error ?? ''}`);
  if (!result.success) {
    throw new Error(`${label} failed: ${result.error ?? result.output ?? 'unknown error'}`);
  }
}

function startFixture(): { pid: number; kill: () => void } {
  const launched = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    fixtureLauncherPath,
    '-FixturePath',
    fixturePath,
    '-StatePath',
    statePath,
  ], {
    encoding: 'utf8',
  });
  if (launched.status !== 0) {
    throw new Error(`Failed to launch fixture: ${launched.stderr || launched.stdout}`);
  }

  const pid = Number(launched.stdout.trim());
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error(`Fixture launcher did not return a valid pid: ${launched.stdout}`);
  }

  console.log(`Launched fixture pid=${pid} statePath=${statePath}`);

  return {
    pid,
    kill: () => {
      spawnSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`,
      ]);
    },
  };
}

try {
  fixture = startFixture();
  const initialState = await waitForState(
    (state) => state.ready === true && state.status === 'ready',
    30_000,
  );

  store = new RunStore(runsDir);
  const runId = store.startRun('Real Computer Use semantic action test', {
    channel: 'scratch-real-test',
    tags: ['computer-use', 'real-desktop', 'semantic-actions'],
  });

  const tool = new ComputerControlTool();

  await runStep(tool, 'focus fixture window', {
    action: 'focus_window',
    windowTitle: fixtureWindowTitle,
    windowTitleMatch: 'contains',
  });
  await delay(500);

  await runStep(tool, 'snapshot fixture controls', {
    action: 'snapshot',
    interactiveOnly: false,
  });

  await runStep(tool, 'fill message field', {
    action: 'fill_text_field',
    name: 'Message',
    text: 'Bonjour reel Computer Use',
    clearFirst: true,
    exactName: true,
    windowTitle: fixtureWindowTitle,
  });

  await runStep(tool, 'select France from country dropdown', {
    action: 'select_dropdown_option',
    name: 'Country',
    option: 'France',
    exactName: true,
    windowTitle: fixtureWindowTitle,
  });

  await runStep(tool, 'refocus fixture after dropdown', {
    action: 'focus_window',
    windowTitle: fixtureWindowTitle,
    windowTitleMatch: 'contains',
  });

  await runStep(tool, 'enable companion checkbox', {
    action: 'toggle_checkbox',
    name: 'Enable companion mode',
    checked: true,
    exactName: true,
    windowTitle: fixtureWindowTitle,
  });

  await runStep(tool, 'select expert radio', {
    action: 'select_radio',
    name: 'Expert mode',
    exactName: true,
    windowTitle: fixtureWindowTitle,
  });

  await runStep(tool, 'activate advanced tab', {
    action: 'activate_tab',
    name: 'Advanced',
    exactName: true,
    windowTitle: fixtureWindowTitle,
  });

  await runStep(tool, 'select blue list item', {
    action: 'select_list_item',
    name: 'Blue',
    exactName: true,
    windowTitle: fixtureWindowTitle,
  });

  await runStep(tool, 'set zoom slider to 75', {
    action: 'set_slider_value',
    name: 'Zoom',
    value: 75,
    exactName: true,
    windowTitle: fixtureWindowTitle,
  });

  await runStep(tool, 'expand projects tree item', {
    action: 'expand_tree_item',
    name: 'Projects',
    exactName: true,
    windowTitle: fixtureWindowTitle,
  });

  await runStep(tool, 'select alpha tree item', {
    action: 'select_tree_item',
    name: 'Alpha',
    exactName: true,
    windowTitle: fixtureWindowTitle,
  });

  await runStep(tool, 'click apply button by name', {
    action: 'click_button',
    name: 'Apply',
    exactName: true,
    windowTitle: fixtureWindowTitle,
  });

  const finalState = await waitForState((state) => state.status === 'saved' && (state.appliedCount ?? 0) > 0);

  await runStep(tool, 'assert saved text visible', {
    action: 'assert_text_visible',
    text: 'Saved',
    exactName: true,
    windowTitle: fixtureWindowTitle,
  });

  const assertions = {
    initialReady: initialState.ready === true,
    messageTyped: finalState.message === 'Bonjour reel Computer Use',
    countrySelected: finalState.country === 'France',
    checkboxEnabled: finalState.companionEnabled === true,
    radioSelected: finalState.mode === 'Expert',
    tabActivated: finalState.activeTab === 'Advanced',
    listItemSelected: finalState.color === 'Blue',
    sliderSet: finalState.zoom === 75,
    treeExpanded: finalState.projectsExpanded === true,
    treeItemSelected: finalState.selectedTreeNode === 'Alpha',
    applyClicked: (finalState.appliedCount ?? 0) >= 1,
    allStepsSucceeded: evidence.every((step) => step.success),
  };
  const passed = Object.values(assertions).every(Boolean);

  const output = {
    passed,
    runId,
    runsDir,
    statePath,
    fixturePath,
    initialState,
    finalState,
    assertions,
    evidence,
    generatedAt: new Date().toISOString(),
  };

  await fs.writeFile(resultPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  store.endRun(runId, passed ? 'completed' : 'failed');

  if (!passed) {
    throw new Error(`Real Computer Use assertions failed: ${JSON.stringify(assertions)}`);
  }

  console.log(JSON.stringify({
    passed,
    runId,
    resultPath,
    finalState,
    assertions,
    stepCount: evidence.length,
  }, null, 2));
} finally {
  if (fixture) {
    fixture.kill();
  }
  if (store) {
    store.dispose();
  }
  if (fsSync.existsSync(statePath)) {
    // Keep state file as evidence next to the result file.
  }
}
