import * as os from 'os';
import * as path from 'path';
import fs from 'fs-extra';
import { CodebaseMapper } from '../../src/context/codebase-map.js';

describe('CodebaseMapper command safety', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-map-security-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it.runIf(process.platform !== 'win32')(
    'treats shell metacharacters in the workspace path as literal argv',
    async () => {
      const hostileRoot = path.join(tmpDir, 'repo$(printf injected)');
      const shellExpandedDecoy = path.join(tmpDir, 'repoinjected');
      await fs.mkdir(hostileRoot);
      await fs.mkdir(shellExpandedDecoy);
      await fs.writeFile(path.join(hostileRoot, 'actual.ts'), 'export const actual = true;\n');
      await fs.writeFile(path.join(shellExpandedDecoy, 'decoy.ts'), 'export const decoy = true;\n');

      const map = await new CodebaseMapper(hostileRoot).buildMap();

      expect([...map.files.keys()]).toContain('actual.ts');
      expect([...map.files.keys()]).not.toContain('decoy.ts');
    }
  );
});
