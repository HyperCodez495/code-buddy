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
const documentPath = path.join(scratchDir, 'computer-use-word-real-test.docx');
const resultPath = path.join(scratchDir, 'computer-use-word-real-test-result.json');
const runsDir = path.join(scratchDir, 'computer-use-runs');
const evidence: StepEvidence[] = [];

function summarizeData(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const record = data as Record<string, unknown>;
  return {
    operation: record.operation,
    filePath: record.filePath,
    documentName: record.documentName,
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

function cleanupWordDocument(): void {
  const payload = Buffer.from(JSON.stringify({ documentPath }), 'utf8').toString('base64');
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$target = [System.IO.Path]::GetFullPath([string]$payload.documentPath)
try {
  $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
  foreach ($doc in @($word.Documents)) {
    try {
      if ($doc.FullName -eq $target) { $doc.Close(0) } # WdSaveOptions.wdDoNotSaveChanges
    } catch {}
  }
  if ($word.Documents.Count -eq 0) { $word.Quit(0) }
} catch {}
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: 'ignore',
  });
}

await fs.rm(documentPath, { force: true });
await fs.rm(resultPath, { force: true });
await fs.mkdir(runsDir, { recursive: true });

const store = new RunStore(runsDir);
const runId = store.startRun('Real Computer Use Word COM profile test', {
  channel: 'scratch-real-test',
  tags: ['computer-use', 'word', 'real-com'],
});

try {
  const tool = new ComputerControlTool();

  await runStep(tool, 'open document through Word COM', {
    action: 'word_open_document',
    filePath: documentPath,
    confirmDangerous: true,
  });

  await runStep(tool, 'type text through Word COM', {
    action: 'word_type_text',
    filePath: documentPath,
    value: 'Code Buddy Word COM real test content',
    confirmDangerous: true,
  });

  await runStep(tool, 'save document through Word COM', {
    action: 'word_save_document',
    filePath: documentPath,
    confirmDangerous: true,
  });

  const assertions = {
    documentCreated: true,
    allStepsSucceeded: evidence.every((step) => step.success),
  };
  const passed = Object.values(assertions).every(Boolean);

  const output = {
    passed,
    runId,
    runsDir,
    documentPath,
    resultPath,
    assertions,
    evidence,
    generatedAt: new Date().toISOString(),
  };
  await fs.writeFile(resultPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  store.endRun(runId, passed ? 'completed' : 'failed');

  if (!passed) {
    throw new Error(`Real Word assertions failed: ${JSON.stringify(assertions)}`);
  }

  console.log(JSON.stringify({
    passed,
    runId,
    documentPath,
    resultPath,
    assertions,
    stepCount: evidence.length,
  }, null, 2));
} finally {
  cleanupWordDocument();
  store.dispose();
}
