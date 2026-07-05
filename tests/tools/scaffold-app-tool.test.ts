import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { ScaffoldAppTool } from '../../src/tools/scaffold-app-tool.js';

describe('ScaffoldAppTool', () => {
  it('scaffolds a node-cli project into an explicit target directory', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'scaffold-app-tool-'));
    const targetDir = path.join(tmp, 'demo-cli');

    const result = await new ScaffoldAppTool().execute({
      template: 'node-cli',
      targetDir,
      vars: { binName: 'demo-cli', description: 'Demo CLI', author: 'Test' },
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    const data = result.data as { filesCreated: string[]; targetDir: string };
    expect(data.targetDir).toBe(targetDir);
    expect(data.filesCreated).toContain('package.json');
    expect(data.filesCreated).toContain('src/index.ts');
    expect(data.filesCreated).toContain('tsconfig.json');

    const packageJson = JSON.parse(await fs.readFile(path.join(targetDir, 'package.json'), 'utf8')) as {
      bin: Record<string, string>;
    };
    expect(packageJson.bin['demo-cli']).toBe('./dist/index.js');
  });

  it('refuses a non-empty target directory', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'scaffold-app-tool-'));
    await fs.writeFile(path.join(tmp, 'existing.txt'), 'content');

    const result = await new ScaffoldAppTool().execute({
      template: 'node-cli',
      targetDir: tmp,
      vars: { binName: 'demo-cli' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not empty');
  });
});
