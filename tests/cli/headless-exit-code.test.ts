import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';

function runCliAgainstFailingProvider(port: number): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.resolve('node_modules/tsx/dist/cli.mjs'),
      'src/index.ts',
      '--prompt',
      'QA headless failure exit code probe',
      '--api-key',
      'test-key',
      '--base-url',
      `http://127.0.0.1:${port}/v1`,
      '--model',
      'qa-mock-model',
      '--max-tool-rounds',
      '1',
      '--no-self-heal',
      '--ephemeral',
      '--quiet',
      '--output-format',
      'json',
    ], {
      cwd: process.cwd(),
      env: {
        ...cleanEnv,
        CODEBUDDY_DISABLE_MCP: 'true',
        CODEBUDDY_HEADLESS: 'true',
        CODEBUDDY_REQUEST_TIMEOUT_MS: '5000',
        LOG_LEVEL: 'error',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', exitCode => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

describe('headless CLI exit codes', () => {
  it('returns non-zero when the provider failure is rendered as an assistant error', async () => {
    const server = http.createServer((req, res) => {
      req.resume();
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'qa forced provider failure' }, path: req.url }));
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected TCP server address');
      }

      const result = await runCliAgainstFailingProvider(address.port);
      expect(result.exitCode).toBe(1);

      const parsed = JSON.parse(result.stdout);
      expect(parsed.result).toContain('qa forced provider failure');
      expect(parsed.messages.at(-1).content).toContain('Sorry, I encountered an error:');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 90_000);
});
