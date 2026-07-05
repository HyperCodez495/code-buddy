import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { TodoScanTool } from '../../src/tools/todo-scan-tool.js';

describe('TodoScanTool', () => {
  it('finds markers and ignores node_modules', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'todo-scan-tool-'));
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.mkdir(path.join(root, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'index.ts'), '// TODO: ship it\n// FIXME broken\n');
    await fs.writeFile(path.join(root, 'node_modules', 'ignored.ts'), '// TODO ignored\n');
    const result = await new TodoScanTool().execute({ root });
    expect(result.success).toBe(true);
    const data = result.data as { total: number; byType: Record<string, Array<{ file: string; line: number; text: string }>> };
    expect(data.total).toBe(2);
    expect(data.byType.TODO[0]).toMatchObject({ file: path.join('src', 'index.ts'), line: 1, text: 'ship it' });
    expect(data.byType.FIXME[0]?.text).toBe('broken');
  });
});
