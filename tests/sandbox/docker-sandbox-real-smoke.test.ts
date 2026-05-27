import { execFileSync } from 'child_process';
import { describe, expect, it } from 'vitest';

import { DockerSandbox } from '../../src/sandbox/docker-sandbox.js';

const REAL_DOCKER_SANDBOX_ENABLED = process.env.CODEBUDDY_REAL_DOCKER_SANDBOX === '1';
const MARKER = 'OK-DOCKER-SANDBOX-REAL';

function dockerPsByName(containerName: string): string {
  return execFileSync(
    'docker',
    ['ps', '--filter', `name=${containerName}`, '--format', '{{.Names}}'],
    { encoding: 'utf-8', timeout: 10000 }
  ).trim();
}

describe.skipIf(!REAL_DOCKER_SANDBOX_ENABLED)('DockerSandbox real smoke', () => {
  it('runs a command in a real network-disabled Docker container and removes it afterwards', async () => {
    expect(DockerSandbox.isAvailable()).toBe(true);

    const sandbox = new DockerSandbox({
      image: 'node:22-slim',
      timeout: 30000,
      memoryLimit: '256m',
      cpuLimit: '1.0',
      networkEnabled: false,
      readOnly: true,
    });

    try {
      const result = await sandbox.execute(
        `node -e "console.log('${MARKER}'); console.log(process.env.CODEBUDDY_CLI)"`
      );

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain(MARKER);
      expect(result.output).toContain('1');
      expect(result.containerId).toMatch(/^codebuddy-sandbox-/);
      expect(sandbox.getActive()).toEqual([]);
      expect(dockerPsByName(result.containerId!)).toBe('');
    } finally {
      await sandbox.dispose();
    }
  }, 60000);
});
