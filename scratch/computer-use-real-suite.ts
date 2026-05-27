import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

interface SuiteCase {
  name: string;
  script: string;
  resultPath: string;
}

interface SuiteResult {
  name: string;
  script: string;
  exitCode: number | null;
  durationMs: number;
  passed: boolean;
  resultPath: string;
  stdoutTail: string;
  stderrTail: string;
  parsedResult?: unknown;
}

const root = process.cwd();
const cases: SuiteCase[] = [
  {
    name: 'Windows Forms controls',
    script: 'scratch/computer-use-real-test.ts',
    resultPath: 'scratch/computer-use-real-test-result.json',
  },
  {
    name: 'Dialog handling',
    script: 'scratch/computer-use-dialog-real-test.ts',
    resultPath: 'scratch/computer-use-dialog-real-test-result.json',
  },
  {
    name: 'Notepad profile save',
    script: 'scratch/computer-use-notepad-real-test.ts',
    resultPath: 'scratch/computer-use-notepad-real-test-result.json',
  },
  {
    name: 'Excel COM profile',
    script: 'scratch/computer-use-excel-real-test.ts',
    resultPath: 'scratch/computer-use-excel-real-test-result.json',
  },
];

function tail(text: string, maxLength = 4000): string {
  return text.length > maxLength ? text.slice(-maxLength) : text;
}

async function runCase(testCase: SuiteCase): Promise<SuiteResult> {
  const startedAt = Date.now();
  const child = spawn('cmd.exe', ['/d', '/s', '/c', 'npx', 'tsx', testCase.script], {
    cwd: root,
    windowsHide: false,
    shell: false,
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    const text = String(chunk);
    stdout += text;
    process.stdout.write(text);
  });
  child.stderr?.on('data', (chunk) => {
    const text = String(chunk);
    stderr += text;
    process.stderr.write(text);
  });

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code));
  });

  let parsedResult: unknown;
  let resultPassed = false;
  try {
    const raw = await fs.readFile(path.join(root, testCase.resultPath), 'utf8');
    parsedResult = JSON.parse(raw.replace(/^\uFEFF/, ''));
    resultPassed = Boolean((parsedResult as { passed?: unknown }).passed);
  } catch {
    parsedResult = undefined;
  }

  return {
    name: testCase.name,
    script: testCase.script,
    exitCode,
    durationMs: Date.now() - startedAt,
    passed: exitCode === 0 && resultPassed,
    resultPath: testCase.resultPath,
    stdoutTail: tail(stdout),
    stderrTail: tail(stderr),
    parsedResult,
  };
}

const results: SuiteResult[] = [];
for (const testCase of cases) {
  console.log(`\n=== ${testCase.name} ===`);
  results.push(await runCase(testCase));
}

const summary = {
  passed: results.every((result) => result.passed),
  generatedAt: new Date().toISOString(),
  results,
};

const summaryPath = path.join(root, 'scratch/computer-use-real-suite-result.json');
await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  passed: summary.passed,
  summaryPath,
  total: results.length,
  passedCount: results.filter((result) => result.passed).length,
}, null, 2));

if (!summary.passed) {
  throw new Error('Computer Use real suite failed.');
}
