#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tscBin = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');

function run(label, command, args, timeoutMs) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${label} exited ${result.status ?? 'without a status'}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return result.stdout.trim();
}

function parseJson(label, output) {
  const jsonStart = output.indexOf('{');
  if (jsonStart < 0) {
    throw new Error(`${label} did not print JSON:\n${output}`);
  }
  try {
    return JSON.parse(output.slice(jsonStart));
  } catch (error) {
    throw new Error(`${label} printed invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

run('TypeScript build', process.execPath, [tscBin], 180_000);

const tools = parseJson(
  'built Hermes tools',
  run('built Hermes tools', process.execPath, ['dist/index.js', 'hermes', 'tools', '--json'], 90_000)
);
if (tools.kind !== 'hermes_official_tool_parity_manifest') {
  throw new Error(`Unexpected tools manifest kind: ${tools.kind}`);
}
if (tools.summary?.gaps !== 0 || tools.summary?.total < 70) {
  throw new Error(`Unexpected Hermes tool parity summary: ${JSON.stringify(tools.summary)}`);
}

const doctor = parseJson(
  'built Hermes doctor',
  run('built Hermes doctor', process.execPath, ['dist/index.js', 'hermes', 'doctor', 'safe', '--json'], 90_000)
);
if (doctor.requestedProfile !== 'safe') {
  throw new Error(`Unexpected doctor profile: ${doctor.requestedProfile}`);
}
if (doctor.diagnostics?.activeToolset?.toolsetId !== 'fleet.hermes.safe') {
  throw new Error(`Unexpected active toolset: ${doctor.diagnostics?.activeToolset?.toolsetId}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        'node node_modules/typescript/bin/tsc',
        'node dist/index.js hermes tools --json',
        'node dist/index.js hermes doctor safe --json',
      ],
      toolSummary: tools.summary,
      activeToolset: doctor.diagnostics.activeToolset.toolsetId,
    },
    null,
    2
  )
);
