import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { BuildProjectTool } from '../../src/tools/build-project-tool.js';
describe('BuildProjectTool', () => { it('runs only package build script', async () => { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'build-project-tool-')); await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { build: 'node build.js' } })); await fs.writeFile(path.join(root, 'build.js'), 'console.log("built ok")\n'); const result = await new BuildProjectTool().execute({ root, timeoutMs: 10000 }); expect(result.success).toBe(true); expect((result.data as { stdoutTail: string }).stdoutTail).toContain('built ok'); }); });
