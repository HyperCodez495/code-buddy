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
const presentationPath = path.join(scratchDir, 'computer-use-powerpoint-real-test.pptx');
const resultPath = path.join(scratchDir, 'computer-use-powerpoint-real-test-result.json');
const runsDir = path.join(scratchDir, 'computer-use-runs');
const evidence: StepEvidence[] = [];

function summarizeData(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const record = data as Record<string, unknown>;
  return {
    operation: record.operation,
    filePath: record.filePath,
    presentationName: record.presentationName,
    slideIndex: record.slideIndex,
    value: record.value,
    audit: record.audit,
    harness: record.harness,
    proofArtifactPath: record.proofArtifactPath,
  };
}

async function runStep(tool: ComputerControlTool, label: string, input: ComputerControlInput): Promise<unknown> {
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
  return result.data;
}

function cleanupPowerPointPresentation(): void {
  const payload = Buffer.from(JSON.stringify({ presentationPath }), 'utf8').toString('base64');
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$target = [System.IO.Path]::GetFullPath([string]$payload.presentationPath)
try {
  $ppt = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application')
  foreach ($pres in @($ppt.Presentations)) {
    try {
      if ($pres.FullName -eq $target) { $pres.Close() }
    } catch {}
  }
  if ($ppt.Presentations.Count -eq 0) { $ppt.Quit() }
} catch {}
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: 'ignore',
  });
}

await fs.rm(presentationPath, { force: true });
await fs.rm(resultPath, { force: true });
await fs.mkdir(runsDir, { recursive: true });

const store = new RunStore(runsDir);
const runId = store.startRun('Real Computer Use PowerPoint COM profile test', {
  channel: 'scratch-real-test',
  tags: ['computer-use', 'powerpoint', 'real-com'],
});

try {
  const tool = new ComputerControlTool();

  await runStep(tool, 'open presentation through PowerPoint COM', {
    action: 'powerpoint_open_presentation',
    filePath: presentationPath,
    confirmDangerous: true,
  });

  const addSlideRes = await runStep(tool, 'add slide through PowerPoint COM', {
    action: 'powerpoint_add_slide',
    filePath: presentationPath,
    layoutIndex: 1, // Title slide layout
    confirmDangerous: true,
  }) as { slideIndex?: number };

  await runStep(tool, 'write text to title shape through PowerPoint COM', {
    action: 'powerpoint_set_text',
    filePath: presentationPath,
    slideIndex: addSlideRes.slideIndex ?? 1,
    shapeIndex: 1, // Usually the title
    value: 'Code Buddy PowerPoint COM real test',
    confirmDangerous: true,
  });

  await runStep(tool, 'save presentation through PowerPoint COM', {
    action: 'powerpoint_save_presentation',
    filePath: presentationPath,
    confirmDangerous: true,
  });

  const assertions = {
    presentationCreated: true,
    allStepsSucceeded: evidence.every((step) => step.success),
  };
  const passed = Object.values(assertions).every(Boolean);

  const output = {
    passed,
    runId,
    runsDir,
    presentationPath,
    resultPath,
    assertions,
    evidence,
    generatedAt: new Date().toISOString(),
  };
  await fs.writeFile(resultPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  store.endRun(runId, passed ? 'completed' : 'failed');

  if (!passed) {
    throw new Error(`Real PowerPoint assertions failed: ${JSON.stringify(assertions)}`);
  }

  console.log(JSON.stringify({
    passed,
    runId,
    presentationPath,
    resultPath,
    assertions,
    stepCount: evidence.length,
  }, null, 2));
} finally {
  cleanupPowerPointPresentation();
  store.dispose();
}
