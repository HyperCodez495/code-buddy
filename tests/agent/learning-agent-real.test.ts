import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildLearningRetrospective,
  listLearningSkillUsage,
  runLearningRetrospective,
  type LearningPatternLibrary,
} from '../../src/agent/learning-agent.js';
import { resetLessonCandidateQueues } from '../../src/agent/lesson-candidate-queue.js';
import { RunStore } from '../../src/observability/run-store.js';

describe('Learning Agent on real RunStore trajectories', () => {
  let tempDir: string;
  let oldCwd: string;
  let store: RunStore;
  let activeRunIds: string[];
  let oldLearningEnv: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-learning-agent-'));
    oldCwd = process.cwd();
    oldLearningEnv = process.env.CODEBUDDY_LEARNING_AGENT;
    process.chdir(tempDir);
    store = new RunStore(path.join(tempDir, 'runs'));
    activeRunIds = [];
    resetLessonCandidateQueues();
  });

  afterEach(async () => {
    for (const runId of activeRunIds) {
      try {
        store.endRun(runId, 'cancelled');
      } catch {
        // Ignore already-ended runs.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    store.dispose();
    resetLessonCandidateQueues();
    process.chdir(oldCwd);
    if (oldLearningEnv === undefined) {
      delete process.env.CODEBUDDY_LEARNING_AGENT;
    } else {
      process.env.CODEBUDDY_LEARNING_AGENT = oldLearningEnv;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function startLearningRun(): string {
    const runId = store.startRun('Real repo workflow with verification', {
      channel: 'cli',
      tags: ['learning-agent'],
    });
    activeRunIds.push(runId);
    store.emit(runId, {
      type: 'skill_selected',
      data: {
        skillName: 'web-audit',
        confidence: 0.91,
        reason: 'matched real workflow',
      },
    });
    store.emit(runId, {
      type: 'tool_call',
      data: { toolCallId: 'call_search', toolName: 'search', args: { query: 'RunStore' } },
    });
    store.emit(runId, {
      type: 'tool_result',
      data: { durationMs: 24, output: 'found src/observability/run-store.ts', success: true, toolName: 'search' },
    });
    store.emit(runId, {
      type: 'tool_call',
      data: { toolCallId: 'call_read', toolName: 'view_file', args: { path: 'src/observability/run-store.ts' } },
    });
    store.emit(runId, {
      type: 'tool_result',
      data: { durationMs: 12, output: 'RunStore source loaded', success: true, toolName: 'view_file' },
    });
    store.emit(runId, {
      type: 'tool_call',
      data: { toolCallId: 'call_test', toolName: 'bash', args: { command: 'npm test -- tests/agent/learning-agent-real.test.ts --run' } },
    });
    store.emit(runId, {
      type: 'tool_result',
      data: { durationMs: 100, output: 'Tests passed', success: true, toolName: 'bash' },
    });
    store.saveArtifact(runId, 'summary.md', 'Real verification passed and produced reusable sequence evidence.');
    return runId;
  }

  it('builds a retrospective, candidates and continuous skill telemetry from real run files', async () => {
    const runId = startLearningRun();
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await new Promise((resolve) => setTimeout(resolve, 120));

    const result = await runLearningRetrospective(store, runId, {
      force: true,
      workDir: tempDir,
    });

    expect(result.skipped).toBe(false);
    expect(result.retrospective?.toolSequence).toEqual(['search', 'view_file', 'bash']);
    expect(result.lessonCandidateCount).toBeGreaterThan(0);
    expect(result.skillCandidateCount).toBe(1);
    expect(result.skillUsageCount).toBe(1);
    expect(store.getArtifact(runId, 'learning-retrospective.json')).toContain('"kind": "learning_retrospective"');
    expect(store.getArtifact(runId, 'learning-retrospective.md')).toContain('Learning Agent retrospective');

    const candidatePath = path.join(tempDir, '.codebuddy', 'skill-candidates', 'learning', 'learned-search-view-file-bash', 'SKILL.md');
    const reviewPath = path.join(tempDir, '.codebuddy', 'skill-candidates', 'learning', 'learned-search-view-file-bash', 'candidate-review.json');
    expect(fs.existsSync(candidatePath)).toBe(true);
    const candidateMarkdown = fs.readFileSync(candidatePath, 'utf8');
    expect(candidateMarkdown).toContain('author: Code Buddy Learning Agent');
    expect(candidateMarkdown).toContain('metadata:\n  hermes:');
    expect(candidateMarkdown).toContain('## Quick Reference');
    expect(JSON.parse(fs.readFileSync(reviewPath, 'utf8'))).toMatchObject({
      approvalRequired: true,
      skillName: 'learned-search-view-file-bash',
      sourceRunId: runId,
    });

    const lessonQueue = JSON.parse(fs.readFileSync(path.join(tempDir, '.codebuddy', 'lesson-candidates.json'), 'utf8'));
    expect(lessonQueue.candidates.length).toBeGreaterThan(0);
    expect(lessonQueue.candidates[0].provenance.runId).toBe(runId);

    const library = JSON.parse(fs.readFileSync(path.join(tempDir, '.codebuddy', 'learning', 'pattern-library.json'), 'utf8')) as LearningPatternLibrary;
    expect(library.patterns).toEqual([
      expect.objectContaining({
        candidateSkillName: 'learned-search-view-file-bash',
        observationCount: 1,
        status: 'observed',
      }),
    ]);

    expect(listLearningSkillUsage(tempDir)).toEqual([
      expect.objectContaining({
        invocationCount: 1,
        skillName: 'web-audit',
        successCount: 1,
      }),
    ]);
  });

  it('auto-runs after endRun when enabled and the run is complex', async () => {
    process.env.CODEBUDDY_LEARNING_AGENT = 'true';
    const runId = startLearningRun();
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);

    await waitFor(() => store.getArtifact(runId, 'learning-retrospective.json') !== null);

    const retrospective = buildLearningRetrospective(runId, { store, workDir: tempDir });
    expect(retrospective?.complexity.isComplex).toBe(true);
    expect(store.getArtifact(runId, 'learning-retrospective.json')).toContain('"skillUsageCount": 1');
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for condition');
}
