import { execFileSync } from 'node:child_process';
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
const notepadPath = path.join(scratchDir, 'computer-use-notepad-real-test.txt');
const resultPath = path.join(scratchDir, 'computer-use-notepad-real-test-result.json');
const runsDir = path.join(scratchDir, 'computer-use-runs');
const desiredText = 'Code Buddy Notepad profile workflow real test';
const evidence: StepEvidence[] = [];

function getNotepadPids(): Set<number> {
  const output = execFileSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    "Get-Process notepad -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }; exit 0",
  ], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return new Set(output.split(/\r?\n/).map((line) => Number(line.trim())).filter(Number.isFinite));
}

function stopNewNotepads(before: Set<number>): void {
  const after = getNotepadPids();
  const created = [...after].filter((pid) => !before.has(pid));
  for (const pid of created) {
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue; exit 0`,
    ], {
      windowsHide: true,
      stdio: 'ignore',
    });
  }
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
    simulated: record.simulated,
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

await fs.writeFile(notepadPath, 'initial text', 'utf8');
await fs.rm(resultPath, { force: true });
await fs.mkdir(runsDir, { recursive: true });

const beforePids = getNotepadPids();
const store = new RunStore(runsDir);
const runId = store.startRun('Real Computer Use Notepad profile workflow test', {
  channel: 'scratch-real-test',
  tags: ['computer-use', 'notepad', 'real-ui'],
});

try {
  const tool = new ComputerControlTool();

  await runStep(tool, 'open Notepad profile with temp file', {
    action: 'open_app',
    appName: 'notepad',
    filePath: notepadPath,
  });

  await runStep(tool, 'write and save through Notepad profile workflow', {
    action: 'use_app_workflow',
    appName: 'notepad',
    filePath: notepadPath,
    visualContext: true,
    steps: [
      { action: 'focus_app' },
      { action: 'clear_and_type', text: desiredText },
      { action: 'save_app_document', confirmDangerous: true },
    ],
  });

  await new Promise((resolve) => setTimeout(resolve, 500));
  const fileContent = await fs.readFile(notepadPath, 'utf8');
  const assertions = {
    fileUpdated: fileContent.trim() === desiredText,
    allStepsSucceeded: evidence.every((step) => step.success),
  };
  const passed = Object.values(assertions).every(Boolean);

  const output = {
    passed,
    runId,
    runsDir,
    notepadPath,
    resultPath,
    desiredText,
    fileContent,
    assertions,
    evidence,
    generatedAt: new Date().toISOString(),
  };
  await fs.writeFile(resultPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  store.endRun(runId, passed ? 'completed' : 'failed');

  if (!passed) {
    throw new Error(`Real Notepad assertions failed: ${JSON.stringify(assertions)} content=${JSON.stringify(fileContent)}`);
  }

  console.log(JSON.stringify({
    passed,
    runId,
    notepadPath,
    resultPath,
    assertions,
    stepCount: evidence.length,
  }, null, 2));
} finally {
  stopNewNotepads(beforePids);
  store.dispose();
}
