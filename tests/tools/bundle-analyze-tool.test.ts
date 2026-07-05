import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { BundleAnalyzeTool } from '../../src/tools/bundle-analyze-tool.js';
describe('BundleAnalyzeTool', () => { it('summarizes dist file sizes', async () => { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bundle-analyze-tool-')); await fs.mkdir(path.join(root, 'dist', 'assets'), { recursive: true }); await fs.writeFile(path.join(root, 'dist', 'a.js'), 'a'.repeat(100)); await fs.writeFile(path.join(root, 'dist', 'assets', 'b.css'), 'b'.repeat(20)); const result = await new BundleAnalyzeTool().execute({ root }); expect(result.success).toBe(true); const data = result.data as { totalSize: number; largest: Array<{ file: string }> }; expect(data.totalSize).toBe(120); expect(data.largest[0].file).toBe('a.js'); }); });
