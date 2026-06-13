import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {
  MemoryCandidateQueue,
  resetMemoryCandidateQueues,
} from '../../src/memory/memory-candidate-queue.js';
import { PersistentMemoryManager } from '../../src/memory/persistent-memory.js';

describe('MemoryCandidateQueue', () => {
  let tmpDir: string;
  let manager: PersistentMemoryManager;
  const projectMemoryPath = () => path.join(tmpDir, '.codebuddy', 'CODEBUDDY_MEMORY.md');
  const userMemoryPath = () => path.join(tmpDir, 'user-memory.md');

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-candidate-test-'));
    manager = new PersistentMemoryManager({
      projectMemoryPath: projectMemoryPath(),
      userMemoryPath: userMemoryPath(),
      autoCapture: false,
    });
    resetMemoryCandidateQueues();
  });

  afterEach(async () => {
    resetMemoryCandidateQueues();
    await fs.remove(tmpDir);
  });

  it('enqueues a pending candidate without writing persistent memory', async () => {
    const queue = new MemoryCandidateQueue(tmpDir, manager);
    const { candidate, deduped } = queue.propose({
      key: 'test-framework',
      value: 'This project uses Vitest for unit tests.',
      scope: 'project',
      category: 'project',
      citations: [{ messageIndex: 1, role: 'user', snippet: 'The project uses Vitest.' }],
    });

    expect(deduped).toBe(false);
    expect(candidate.status).toBe('pending');
    expect(candidate.citations?.[0]?.snippet).toContain('Vitest');
    expect(await fs.pathExists(projectMemoryPath())).toBe(false);
    expect(await fs.pathExists(path.join(tmpDir, '.codebuddy', 'memory-candidates.json'))).toBe(true);
  });

  it('deduplicates identical pending candidates', () => {
    const queue = new MemoryCandidateQueue(tmpDir, manager);
    const first = queue.propose({ key: 'indent-style', value: 'Use two spaces.' });
    const second = queue.propose({ key: 'indent-style', value: 'use two spaces.  ' });

    expect(second.deduped).toBe(true);
    expect(second.candidate.id).toBe(first.candidate.id);
    expect(queue.list('pending')).toHaveLength(1);
  });

  it('requires explicit approval before writing bounded persistent memory', async () => {
    const queue = new MemoryCandidateQueue(tmpDir, manager);
    const { candidate } = queue.propose({
      key: 'runtime',
      value: 'The project targets Node 22 or newer.',
      category: 'project',
    });

    await expect(queue.accept(candidate.id, { reviewedBy: '   ' })).rejects.toThrow(/human approval/i);
    expect(manager.recall('runtime', 'project')).toBeNull();

    const accepted = await queue.accept(candidate.id, { reviewedBy: 'Patrice' });

    expect(accepted.candidate.status).toBe('accepted');
    expect(accepted.write.status).toBe('stored');
    expect(manager.recall('runtime', 'project')).toBe('The project targets Node 22 or newer.');
    const content = await fs.readFile(projectMemoryPath(), 'utf-8');
    expect(content).toContain('- **runtime**: The project targets Node 22 or newer.');
  });

  it('rejects sensitive candidates before queueing', () => {
    const queue = new MemoryCandidateQueue(tmpDir, manager);
    expect(() => queue.propose({
      key: 'secret',
      value: 'The API key is sk-proj-123456789012345678901234.',
    })).toThrow(/sensitive material/i);
  });

  it('marks a candidate rejected with a reason and reloads from disk', () => {
    const queue = new MemoryCandidateQueue(tmpDir, manager);
    const { candidate } = queue.propose({ key: 'noise', value: 'This is not durable enough.' });
    queue.reject(candidate.id, { reviewedBy: 'reviewer', reason: 'too transient' });

    const reloaded = new MemoryCandidateQueue(tmpDir, manager);
    expect(reloaded.get(candidate.id)?.status).toBe('rejected');
    expect(reloaded.get(candidate.id)?.reviewNote).toBe('too transient');
    expect(reloaded.getStats().byStatus.rejected).toBe(1);
  });
});
