import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { CodeStatsTool } from '../../src/tools/code-stats-tool.js';

describe('CodeStatsTool', () => {
  it('counts code lines by language and ignores node_modules', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'code-stats-tool-'));
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.mkdir(path.join(root, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'index.ts'), '// comment\nconst x = 1;\n');
    await fs.writeFile(path.join(root, 'README.md'), '# Demo\ntext\n');
    await fs.writeFile(path.join(root, 'node_modules', 'ignored.ts'), 'const ignored = true;\n');
    const result = await new CodeStatsTool().execute({ root });
    expect(result.success).toBe(true);
    const data = result.data as { fileCount: number; byLanguage: Record<string, { files: number; commentLines: number }>; largestFiles: Array<{ file: string }> };
    expect(data.fileCount).toBe(2);
    expect(data.byLanguage.TypeScript.files).toBe(1);
    expect(data.byLanguage.TypeScript.commentLines).toBe(1);
    expect(data.largestFiles.some((file) => file.file.includes('ignored'))).toBe(false);
  });
});
