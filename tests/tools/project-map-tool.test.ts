import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { ProjectMapTool } from '../../src/tools/project-map-tool.js';

describe('ProjectMapTool', () => {
  it('summarizes project structure and likely entrypoints', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-map-tool-'));
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.mkdir(path.join(root, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ main: 'src/index.ts' }));
    await fs.writeFile(path.join(root, 'src', 'index.ts'), 'export const ok = true;\n');
    await fs.writeFile(path.join(root, 'README.md'), '# Demo\n');
    await fs.writeFile(path.join(root, 'node_modules', 'ignored.js'), 'ignored');

    const result = await new ProjectMapTool().execute({ root, maxDepth: 3 });

    expect(result.success).toBe(true);
    const data = result.data as { fileCount: number; directoryCount: number; languages: Record<string, number>; entrypoints: string[]; tree: string[] };
    expect(data.fileCount).toBe(3);
    expect(data.directoryCount).toBe(1);
    expect(data.languages.TypeScript).toBe(1);
    expect(data.languages.Markdown).toBe(1);
    expect(data.entrypoints).toContain('src/index.ts');
    expect(data.tree.some((line) => line.includes('node_modules'))).toBe(false);
  });
});
