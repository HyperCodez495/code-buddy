import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DeployService } from '../src/main/studio2/deploy-service.js';

describe('DeployService', () => {
  it('falls back to a local zip when deploy CLIs are absent', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'studio2-deploy-'));
    const buildDir = path.join(root, 'dist');
    await mkdir(buildDir, { recursive: true });
    await writeFile(path.join(buildDir, 'index.html'), '<h1>Hello</h1>');
    class NoCliDeployService extends DeployService { override detectCli(): Promise<string | null> { return Promise.resolve(null); } }
    const result = await new NoCliDeployService().deploy({ projectRoot: root, buildDir: 'dist', target: 'surge' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.mode).toBe('zip');
    expect(await readFile(result.data.outputPath!)).toBeInstanceOf(Buffer);
  });
});
