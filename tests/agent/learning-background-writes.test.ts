/**
 * Closed-learning-loop background writes (Hermes parity — opt-in, OFF by default).
 *
 * These tests prove the four behavioural guarantees of the opt-in:
 *
 *   1. OFF by default: inferred candidates go to the review queue and the active
 *      user model is NOT mutated without an explicit human acceptance.
 *   2. ON + at/above threshold: the candidate is written directly in background
 *      (real round-trip through `accept()`), and telemetry marks it auto-written.
 *   3. ON but below threshold: falls back to the review queue (no auto-write).
 *   4. The sensitive category (skills) stays gated even when observation
 *      auto-write is ON, and the privacy screen still refuses sensitive content
 *      on the auto-write path.
 *
 * Each test uses a unique temp workDir so per-workDir singletons never bleed, and
 * restores every env flag it touches. The honest path is exercised end-to-end via
 * `runUserLocalInference` (deterministic local cues), not by poking the policy
 * module directly.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatEntry } from '../../src/agent/types.js';
import {
  LocalUserModel,
  getUserModel,
  resetUserModels,
  runUserLocalInference,
} from '../../src/memory/user-model.js';
import {
  getBackgroundWritePolicy,
  isBackgroundWritesEnabled,
  listBackgroundWriteAudit,
  promoteObservations,
  BACKGROUND_WRITE_REVIEWER,
  DEFAULT_BACKGROUND_WRITE_MIN_CONFIDENCE,
} from '../../src/agent/learning-background-writes.js';
import { buildHermesLearningLoopStatus } from '../../src/agent/hermes-learning-loop-status.js';

const FLAG = 'CODEBUDDY_LEARNING_BACKGROUND_WRITES';
const SKILL_FLAG = 'CODEBUDDY_LEARNING_BACKGROUND_WRITE_SKILLS';
const MIN_CONF = 'CODEBUDDY_LEARNING_BACKGROUND_WRITE_MIN_CONFIDENCE';

// A message that triggers two known local-inference cues with different
// confidences: "real tests over mocks" (0.92, above default 0.85) and the
// French-collaboration cue (0.78, below default 0.85).
const MIXED_CONFIDENCE_HISTORY: ChatEntry[] = [
  {
    type: 'user',
    content: 'fais des tests reels, je ne veux plus de mocks, corrige et ameliore',
    timestamp: new Date(),
  },
];

describe('learning background writes (opt-in, OFF by default)', () => {
  let tmpDir: string;
  let savedFlag: string | undefined;
  let savedSkillFlag: string | undefined;
  let savedMinConf: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'learning-bg-writes-'));
    savedFlag = process.env[FLAG];
    savedSkillFlag = process.env[SKILL_FLAG];
    savedMinConf = process.env[MIN_CONF];
    delete process.env[FLAG];
    delete process.env[SKILL_FLAG];
    delete process.env[MIN_CONF];
    resetUserModels();
  });

  afterEach(async () => {
    restoreEnv(FLAG, savedFlag);
    restoreEnv(SKILL_FLAG, savedSkillFlag);
    restoreEnv(MIN_CONF, savedMinConf);
    resetUserModels();
    await fs.remove(tmpDir);
  });

  describe('policy resolution (fail-closed)', () => {
    it('is disabled by default with no env set', () => {
      expect(isBackgroundWritesEnabled()).toBe(false);
      const policy = getBackgroundWritePolicy();
      expect(policy.enabled).toBe(false);
      expect(policy.allowedCategories).toEqual([]);
      expect(policy.minConfidence).toBe(DEFAULT_BACKGROUND_WRITE_MIN_CONFIDENCE);
    });

    it('treats unknown values as disabled (fail-closed)', () => {
      process.env[FLAG] = 'maybe';
      expect(isBackgroundWritesEnabled()).toBe(false);
    });

    it('enables observation writes only when explicitly on; skills need a separate flag', () => {
      process.env[FLAG] = 'true';
      let policy = getBackgroundWritePolicy();
      expect(policy.enabled).toBe(true);
      expect(policy.allowedCategories).toEqual(['observation']);
      expect(policy.allowSkillWrites).toBe(false);

      process.env[SKILL_FLAG] = 'true';
      policy = getBackgroundWritePolicy();
      expect(policy.allowSkillWrites).toBe(true);
      expect(policy.allowedCategories).toEqual(['observation', 'skill']);
    });
  });

  describe('OFF by default', () => {
    it('routes inferred candidates to review without mutating the active model', () => {
      const proposed = runUserLocalInference(MIXED_CONFIDENCE_HISTORY, tmpDir);
      expect(proposed.length).toBeGreaterThan(0);
      // Strong assertion: nothing entered the active model without human review.
      expect(proposed.every((obs) => obs.status === 'pending')).toBe(true);

      const model = new LocalUserModel(tmpDir);
      expect(model.getAccepted()).toHaveLength(0);
      expect(model.list('pending').length).toBe(proposed.length);

      // No auto-write audit trail was created.
      expect(listBackgroundWriteAudit(tmpDir)).toHaveLength(0);
    });
  });

  describe('ON + at/above threshold', () => {
    it('writes the high-confidence observation directly in background (real round-trip)', () => {
      process.env[FLAG] = 'true';

      const proposed = runUserLocalInference(MIXED_CONFIDENCE_HISTORY, tmpDir);

      // The 0.92 "real tests over mocks" cue is auto-written; it appears in the
      // active model WITHOUT any manual accept() call.
      const model = getUserModel(tmpDir);
      const accepted = model.getAccepted();
      const realTests = accepted.find((obs) =>
        obs.content.includes('real verification paths over mocks')
      );
      expect(realTests).toBeDefined();
      expect(realTests?.status).toBe('accepted');
      // Telemetry discriminator: auto-written, not human-approved.
      expect(realTests?.reviewedBy).toBe(BACKGROUND_WRITE_REVIEWER);

      // The summarized model surfaces the auto-written preference for injection.
      expect(model.summarize()).toContain('real verification paths over mocks');

      // The auto-write is recorded in the auditable side-car.
      const audit = listBackgroundWriteAudit(tmpDir);
      expect(audit.some((entry) => entry.observationId === realTests?.id)).toBe(true);
      expect(audit.every((entry) => entry.reviewer === BACKGROUND_WRITE_REVIEWER)).toBe(true);

      // Learning-loop telemetry marks the auto-write distinctly from review gates.
      const status = buildHermesLearningLoopStatus({ workDir: tmpDir });
      expect(status.backgroundWrites.enabled).toBe(true);
      expect(status.backgroundWrites.autoWrittenObservationCount).toBeGreaterThan(0);
      expect(status.backgroundWrites.allowedCategories).toEqual(['observation']);
      // Review gates remain intact (never flipped to false).
      expect(Object.values(status.reviewGates).every(Boolean)).toBe(true);
    });

    it('keeps rollback available: discard() reverts an auto-written observation', () => {
      process.env[FLAG] = 'true';
      runUserLocalInference(MIXED_CONFIDENCE_HISTORY, tmpDir);

      const model = getUserModel(tmpDir);
      const accepted = model.getAccepted();
      expect(accepted.length).toBeGreaterThan(0);

      const target = accepted[0]!;
      model.discard(target.id, { reviewedBy: 'Patrice', reason: 'rollback auto-write' });
      expect(model.getAccepted().some((obs) => obs.id === target.id)).toBe(false);
    });
  });

  describe('ON but below threshold', () => {
    it('leaves the low-confidence candidate in the review queue (no auto-write)', () => {
      process.env[FLAG] = 'true';

      const proposed = runUserLocalInference(MIXED_CONFIDENCE_HISTORY, tmpDir);

      // The 0.78 French cue is below the 0.85 default threshold → stays pending.
      const frenchCandidate = proposed.find((obs) =>
        obs.content.includes('Prefers French for collaboration updates')
      );
      expect(frenchCandidate).toBeDefined();
      expect(frenchCandidate?.status).toBe('pending');

      const model = getUserModel(tmpDir);
      expect(model.getAccepted().some((obs) => obs.id === frenchCandidate?.id)).toBe(false);
      expect(model.list('pending').some((obs) => obs.id === frenchCandidate?.id)).toBe(true);
    });

    it('respects a custom (higher) threshold so nothing is auto-written', () => {
      process.env[FLAG] = 'true';
      process.env[MIN_CONF] = '0.99';

      runUserLocalInference(MIXED_CONFIDENCE_HISTORY, tmpDir);
      const model = getUserModel(tmpDir);
      expect(model.getAccepted()).toHaveLength(0);
      expect(listBackgroundWriteAudit(tmpDir)).toHaveLength(0);
    });
  });

  describe('sensitive category + privacy stay gated even when ON', () => {
    it('does not expose a skill category for auto-write unless the skill flag is set', () => {
      process.env[FLAG] = 'true';
      expect(getBackgroundWritePolicy().allowedCategories).not.toContain('skill');
    });

    it('refuses sensitive content on the auto-write path and defers to review', () => {
      process.env[FLAG] = 'true';
      const model = getUserModel(tmpDir);

      // A pending observation whose content is sensitive cannot exist via
      // observe() (privacy screen), so we craft the pending record directly to
      // prove accept() (and thus promoteObservations) re-screens it.
      const sensitive = model.observe({
        kind: 'preference',
        content: 'Prefers TypeScript for backend work.',
        confidence: 0.95,
      }).observation;
      // Mutate the pending content to sensitive text (simulating a poisoned
      // candidate); the auto-write path must refuse it and leave it pending.
      sensitive.content = 'Has a medical diagnosis to track.';

      const result = promoteObservations(model, [sensitive], tmpDir);
      expect(result.autoWritten).toHaveLength(0);
      expect(result.deferred.some((obs) => obs.id === sensitive.id)).toBe(true);
      expect(model.getAccepted()).toHaveLength(0);
    });
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
