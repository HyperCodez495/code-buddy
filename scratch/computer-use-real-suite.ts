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
  skipped?: boolean;
  skipReason?: string;
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
  {
    name: 'PowerPoint COM profile',
    script: 'scratch/computer-use-powerpoint-real-test.ts',
    resultPath: 'scratch/computer-use-powerpoint-real-test-result.json',
  },
  {
    name: 'Word COM profile',
    script: 'scratch/computer-use-word-real-test.ts',
    resultPath: 'scratch/computer-use-word-real-test-result.json',
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
    let settled = false;
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      const message = error instanceof Error ? error.message : String(error);
      stderr += message;
      process.stderr.write(`${message}\n`);
      resolve(null);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      resolve(code);
    });
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

const summaryPath = path.join(root, 'scratch/computer-use-real-suite-result.json');
const results: SuiteResult[] = [];
let platformError: string | undefined;

if (process.platform !== 'win32') {
  platformError =
    `Computer Use real suite requires Windows because it drives WinForms, Notepad, Excel COM, PowerPoint COM, and Word COM; current platform is ${process.platform}.`;
  for (const testCase of cases) {
    results.push({
      name: testCase.name,
      script: testCase.script,
      exitCode: null,
      durationMs: 0,
      passed: false,
      resultPath: testCase.resultPath,
      stdoutTail: '',
      stderrTail: platformError,
      skipped: true,
      skipReason: platformError,
    });
  }
} else {
  for (const testCase of cases) {
    console.log(`\n=== ${testCase.name} ===`);
    results.push(await runCase(testCase));
  }
}

const summary = {
  passed: results.every((result) => result.passed),
  generatedAt: new Date().toISOString(),
  ...(platformError ? { platformError } : {}),
  results,
};

await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  passed: summary.passed,
  summaryPath,
  total: results.length,
  passedCount: results.filter((result) => result.passed).length,
}, null, 2));

if (!summary.passed) {
  console.error(platformError ?? 'Computer Use real suite failed.');
  process.exit(1);
}
