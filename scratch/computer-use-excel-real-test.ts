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
const workbookPath = path.join(scratchDir, 'computer-use-excel-real-test.xlsx');
const resultPath = path.join(scratchDir, 'computer-use-excel-real-test-result.json');
const runsDir = path.join(scratchDir, 'computer-use-runs');
const evidence: StepEvidence[] = [];

function summarizeData(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const record = data as Record<string, unknown>;
  return {
    operation: record.operation,
    filePath: record.filePath,
    workbookName: record.workbookName,
    sheetName: record.sheetName,
    cell: record.cell,
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

function cleanupExcelWorkbook(): void {
  const payload = Buffer.from(JSON.stringify({ workbookPath }), 'utf8').toString('base64');
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$target = [System.IO.Path]::GetFullPath([string]$payload.workbookPath)
try {
  $excel = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application')
  foreach ($book in @($excel.Workbooks)) {
    try {
      if ($book.FullName -eq $target) { $book.Close($true) }
    } catch {}
  }
  if ($excel.Workbooks.Count -eq 0) { $excel.Quit() }
} catch {}
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: 'ignore',
  });
}

await fs.rm(workbookPath, { force: true });
await fs.rm(resultPath, { force: true });
await fs.mkdir(runsDir, { recursive: true });

const store = new RunStore(runsDir);
const runId = store.startRun('Real Computer Use Excel COM profile test', {
  channel: 'scratch-real-test',
  tags: ['computer-use', 'excel', 'real-com'],
});

try {
  const tool = new ComputerControlTool();

  await runStep(tool, 'write A1 through Excel COM', {
    action: 'excel_set_cell',
    filePath: workbookPath,
    cell: 'A1',
    value: 'Code Buddy Excel COM real test',
    confirmDangerous: true,
  });

  await runStep(tool, 'write B1 through Excel COM', {
    action: 'excel_set_cell',
    filePath: workbookPath,
    cell: 'B1',
    value: '42',
    confirmDangerous: true,
  });

  const a1 = await runStep(tool, 'read A1 through Excel COM', {
    action: 'excel_get_cell',
    filePath: workbookPath,
    cell: 'A1',
  }) as { value?: unknown };

  const b1 = await runStep(tool, 'read B1 through Excel COM', {
    action: 'excel_get_cell',
    filePath: workbookPath,
    cell: 'B1',
  }) as { value?: unknown };

  await runStep(tool, 'save workbook through Excel COM', {
    action: 'excel_save_workbook',
    filePath: workbookPath,
    confirmDangerous: true,
  });

  const assertions = {
    workbookCreated: true,
    a1Matches: a1.value === 'Code Buddy Excel COM real test',
    b1Matches: String(b1.value) === '42',
    allStepsSucceeded: evidence.every((step) => step.success),
  };
  const passed = Object.values(assertions).every(Boolean);

  const output = {
    passed,
    runId,
    runsDir,
    workbookPath,
    resultPath,
    assertions,
    evidence,
    generatedAt: new Date().toISOString(),
  };
  await fs.writeFile(resultPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  store.endRun(runId, passed ? 'completed' : 'failed');

  if (!passed) {
    throw new Error(`Real Excel assertions failed: ${JSON.stringify(assertions)}`);
  }

  console.log(JSON.stringify({
    passed,
    runId,
    workbookPath,
    resultPath,
    assertions,
    stepCount: evidence.length,
  }, null, 2));
} finally {
  cleanupExcelWorkbook();
  store.dispose();
}
