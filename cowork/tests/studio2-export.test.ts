import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ExportService } from '../src/main/studio2/export-service.js';

describe('ExportService', () => {
  it('exports a project zip and imports an external folder into workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'studio2-export-root-'));
    await writeFile(path.join(root, 'index.html'), 'hello');
    const service = new ExportService();
    const exported = await service.exportProject({ projectRoot: root });
    expect(exported.ok).toBe(true);
    if (exported.ok) expect(await readFile(exported.data.zipPath)).toBeInstanceOf(Buffer);
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'studio2-workspace-'));
    const external = await mkdtemp(path.join(os.tmpdir(), 'studio2-external-'));
    await mkdir(path.join(external, 'src'));
    await writeFile(path.join(external, 'src', 'App.tsx'), 'export default null;');
    const imported = await service.importFolder({ workspaceRoot: workspace, sourcePath: external, projectName: 'imported' });
    expect(imported.ok).toBe(true);
    if (imported.ok) expect(await readFile(path.join(imported.data.projectPath, 'src', 'App.tsx'), 'utf8')).toContain('export default');
  });
});
