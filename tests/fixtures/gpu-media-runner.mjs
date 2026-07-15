import { readFile, writeFile } from 'node:fs/promises';

const requestPath = process.argv.at(-1);
const resultPath = process.env.CODEBUDDY_GPU_JOB_RESULT;
if (!requestPath || !resultPath) process.exit(2);

const request = JSON.parse(await readFile(requestPath, 'utf8'));
if (request.payload?.sceneId?.includes('progress')) {
  process.stdout.write('CODEBUDDY_PRO');
  await new Promise((resolve) => setTimeout(resolve, 10));
  process.stdout.write('GRESS 0.25 loading checkpoint\n');
  await new Promise((resolve) => setTimeout(resolve, 250));
  process.stdout.write('CODEBUDDY_PROGRESS 0.75 reconstructing scene\n');
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (request.payload?.sceneId?.includes('failure')) {
  process.stderr.write('PanoWorld runner error: synthetic model failure\n');
  process.exit(7);
}
if (request.payload?.prompt?.includes('[delay]')) {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}
await writeFile(
  resultPath,
  `${JSON.stringify({
    jobId: request.id,
    kind: request.kind,
    artifact: 'result.bin',
    requestEnvMatchesArgument: process.env.CODEBUDDY_GPU_JOB_REQUEST === requestPath,
  })}\n`,
  'utf8'
);
