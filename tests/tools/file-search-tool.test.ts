import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { FileSearchTool } from '../../src/tools/file-search-tool.js';
describe('FileSearchTool', () => { it('searches text files and ignores node_modules', async () => { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-search-tool-')); await fs.mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true }); await fs.writeFile(path.join(root, 'a.txt'), 'alpha\nbeta needle\n'); await fs.writeFile(path.join(root, 'node_modules', 'pkg', 'b.txt'), 'needle\n'); const result = await new FileSearchTool().execute({ root, pattern: 'needle' }); expect(result.success).toBe(true); expect((result.data as { matches: Array<{ file: string; line: number }> }).matches).toEqual([{ file: 'a.txt', line: 2, excerpt: 'beta needle' }]); }); });
