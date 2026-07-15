import { readFile, writeFile } from 'node:fs/promises';

const requestPath = process.argv.at(-1);
const resultPath = process.env.CODEBUDDY_GPU_JOB_RESULT;
if (!requestPath || !resultPath) process.exit(2);

const request = JSON.parse(await readFile(requestPath, 'utf8'));
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
