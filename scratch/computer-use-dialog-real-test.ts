import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ComputerControlTool, type ComputerControlInput } from '../src/tools/computer-control-tool.js';
import { RunStore } from '../src/observability/run-store.js';

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
const fixturePath = path.join(scratchDir, 'computer-use-dialog-fixture.ps1');
const fixtureResultPath = path.join(scratchDir, 'computer-use-dialog-fixture-result.json');
const resultPath = path.join(scratchDir, 'computer-use-dialog-real-test-result.json');
const runsDir = path.join(scratchDir, 'computer-use-runs');
const evidence: StepEvidence[] = [];

function summarizeData(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const record = data as Record<string, unknown>;
  return {
    dialog: record.dialog,
    selectedButton: record.selectedButton,
    reason: record.reason,
    audit: record.audit,
    harness: record.harness ? {
      proof: (record.harness as { proof?: unknown }).proof,
      sensitiveAction: (record.harness as { sensitiveAction?: unknown }).sensitiveAction,
      approval: (record.harness as { approval?: unknown }).approval,
    } : undefined,
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

await fs.rm(resultPath, { force: true });
await fs.rm(fixtureResultPath, { force: true });
await fs.mkdir(runsDir, { recursive: true });

const child = spawn('powershell.exe', [
  '-NoProfile',
  '-STA',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  fixturePath,
  '-ResultPath',
  fixtureResultPath,
], {
  detached: false,
  windowsHide: false,
  stdio: 'ignore',
});

const store = new RunStore(runsDir);
const runId = store.startRun('Real Computer Use dialog handling test', {
  channel: 'scratch-real-test',
  tags: ['computer-use', 'dialog', 'real-ui'],
});

try {
  const tool = new ComputerControlTool();
  const target = {
    windowTitle: 'CodeBuddy Dialog Fixture',
    windowTitleMatch: 'contains' as const,
  };

  await runStep(tool, 'wait for dialog fixture', {
    action: 'wait_for_window',
    ...target,
    timeoutMs: 10000,
  });
  await runStep(tool, 'focus dialog fixture', {
    action: 'focus_window',
    ...target,
  });
  await runStep(tool, 'settle dialog fixture', {
    action: 'wait',
    seconds: 0.5,
  });
  await runStep(tool, 'inspect dialog choices', {
    action: 'inspect_dialog',
    ...target,
    dialogText: 'save changes',
    dialogIntent: 'cancel',
  });
  await runStep(tool, 'click safe cancel choice', {
    action: 'click_dialog_button',
    ...target,
    dialogIntent: 'cancel',
  });

  await new Promise((resolve) => setTimeout(resolve, 500));
  const fixtureResultText = (await fs.readFile(fixtureResultPath, 'utf8')).replace(/^\uFEFF/, '');
  const fixtureResult = JSON.parse(fixtureResultText) as { decision?: string };
  const assertions = {
    clickedCancel: fixtureResult.decision === 'cancel',
    didNotClickSaveOrDelete: fixtureResult.decision !== 'save' && fixtureResult.decision !== 'delete',
    allStepsSucceeded: evidence.every((step) => step.success),
  };
  const passed = Object.values(assertions).every(Boolean);
  const output = {
    passed,
    runId,
    runsDir,
    resultPath,
    fixtureResult,
    assertions,
    evidence,
    generatedAt: new Date().toISOString(),
  };
  await fs.writeFile(resultPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  store.endRun(runId, passed ? 'completed' : 'failed');

  if (!passed) {
    throw new Error(`Real dialog assertions failed: ${JSON.stringify(assertions)}`);
  }

  console.log(JSON.stringify({
    passed,
    runId,
    resultPath,
    assertions,
    stepCount: evidence.length,
  }, null, 2));
} finally {
  if (!child.killed) {
    child.kill();
  }
  store.dispose();
}
