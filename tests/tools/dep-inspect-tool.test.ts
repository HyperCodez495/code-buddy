import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { DepInspectTool } from '../../src/tools/dep-inspect-tool.js';

describe('DepInspectTool', () => {
  it('parses package.json and local lockfile presence', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dep-inspect-tool-'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      scripts: { test: 'vitest' }, engines: { node: '>=22' }, dependencies: { express: '^5.0.0' }, devDependencies: { vitest: '^4.0.0' },
    }));
    await fs.writeFile(path.join(root, 'package-lock.json'), '{}');

    const result = await new DepInspectTool().execute({ root });

    expect(result.success).toBe(true);
    const data = result.data as { totalDependencies: number; lockfile?: string; scripts: Record<string, string>; engines: Record<string, string> };
    expect(data.totalDependencies).toBe(2);
    expect(data.lockfile).toBe('package-lock.json');
    expect(data.scripts.test).toBe('vitest');
    expect(data.engines.node).toBe('>=22');
  });
});
