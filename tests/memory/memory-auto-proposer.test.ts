import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import type { CodeBuddyClient } from '../../src/codebuddy/client.js';
import type { ChatEntry } from '../../src/agent/types.js';
import {
  buildMemoryCitations,
  extractHeuristicMemoryCandidates,
  proposeMemoryCandidatesFromSession,
} from '../../src/memory/memory-auto-proposer.js';
import { resetMemoryCandidateQueues } from '../../src/memory/memory-candidate-queue.js';

function entry(type: ChatEntry['type'], content: string): ChatEntry {
  return { type, content, timestamp: new Date() };
}

describe('memory-auto-proposer', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-auto-proposer-'));
    resetMemoryCandidateQueues();
  });

  afterEach(async () => {
    resetMemoryCandidateQueues();
    await fs.remove(tmpDir);
  });

  it('extracts deterministic candidates for explicit memory-like statements', () => {
    const candidates = extractHeuristicMemoryCandidates([
      entry('user', 'Remember that this repo uses Vitest and ESM imports with .js extensions.'),
    ]);

    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates.some((candidate) =>
      candidate.scope === 'project' && candidate.value.includes('Vitest')
    )).toBe(true);
  });

  it('builds transcript citations around matching evidence', () => {
    const citations = buildMemoryCitations([
      entry('user', 'The project uses Vitest for all unit tests.'),
      entry('assistant', 'I will update the test plan.'),
    ], 'Vitest unit tests', 'session-1');

    expect(citations[0]).toMatchObject({
      sessionId: 'session-1',
      messageIndex: 1,
      role: 'user',
    });
    expect(citations[0]?.snippet).toContain('Vitest');
  });

  it('proposes queued memory candidates from a supplied LLM client', async () => {
    const client = {
      chat: vi.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify([
              {
                key: 'test-framework',
                value: 'The project uses Vitest for unit tests.',
                scope: 'project',
                category: 'project',
                confidence: 0.91,
                rationale: 'User stated the test framework.',
              },
            ]),
          },
        }],
      }),
    } as unknown as CodeBuddyClient;

    const proposed = await proposeMemoryCandidatesFromSession([
      entry('user', 'The project uses Vitest for unit tests.'),
      entry('assistant', 'Noted.'),
    ], tmpDir, client, 'sess-123');

    expect(proposed).toHaveLength(1);
    expect(proposed[0]?.status).toBe('pending');
    expect(proposed[0]?.key).toBe('test-framework');
    expect(proposed[0]?.citations?.[0]?.sessionId).toBe('sess-123');
    expect(await fs.pathExists(path.join(tmpDir, '.codebuddy', 'memory-candidates.json'))).toBe(true);
  });

  it('falls back to heuristic candidates when no LLM candidate is available', async () => {
    const proposed = await proposeMemoryCandidatesFromSession([
      entry('user', 'I prefer single quotes in TypeScript files.'),
      entry('assistant', 'Understood.'),
    ], tmpDir);

    expect(proposed).toHaveLength(1);
    expect(proposed[0]?.scope).toBe('user');
    expect(proposed[0]?.category).toBe('preferences');
  });
});
