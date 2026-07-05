import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GitService } from '../src/main/studio2/git-service.js';

describe('GitService', () => {
  it('initializes, commits, and reads log in a tmp project', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'studio2-git-'));
    const service = new GitService();
    expect((await service.init(root)).ok).toBe(true);
    await writeFile(path.join(root, 'README.md'), 'hello');
    const commit = await service.commit(root, 'feat: initial app');
    expect(commit.ok).toBe(true);
    const log = await service.log(root);
    expect(log.ok).toBe(true);
    if (log.ok) expect(log.data[0].subject).toBe('feat: initial app');
  });
});
