/**
 * Tests for the spec pipeline store (BMAD-inspired foundation).
 *
 * Focus: the status state machine (every legal transition works, every illegal
 * one is rejected) and persistence round-trips. No LLM involved.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import {
  SpecStore,
  getSpecStore,
  resetSpecStores,
  isLegalTransition,
  SpecTransitionError,
  SPEC_STORY_STATUSES,
} from '../../src/spec/spec-store.js';

describe('SpecStore', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-store-test-'));
    resetSpecStores();
  });

  afterEach(async () => {
    resetSpecStores();
    await fs.remove(tmpDir);
  });

  function newStory(store: SpecStore, projectId: string, title = 'A story') {
    return store.addStory(projectId, { title, acceptanceCriteria: ['does the thing'] });
  }

  describe('projects', () => {
    it('creates a project, persists the manifest, and sets it active', () => {
      const store = new SpecStore(tmpDir);
      const project = store.createProject('Radar map app');
      expect(project.id).toMatch(/^sp-/);
      expect(store.getActiveProjectId()).toBe(project.id);
      expect(fs.existsSync(path.join(tmpDir, '.codebuddy', 'specs', project.id, 'project.json'))).toBe(true);
    });

    it('requires a title', () => {
      expect(() => new SpecStore(tmpDir).createProject('  ')).toThrow(/title is required/i);
    });
  });

  describe('stories: creation', () => {
    it('adds a story in draft with opaque id and acceptance criteria', () => {
      const store = new SpecStore(tmpDir);
      const p = store.createProject('p');
      const story = store.addStory(p.id, {
        title: 'Render radars on map',
        narrative: 'Use a webview React layer.',
        acceptanceCriteria: ['shows radars within 5km', 'updates on move'],
      });
      expect(story.id).toMatch(/^st-/);
      expect(story.status).toBe('draft');
      expect(story.acceptanceCriteria).toHaveLength(2);
      expect(fs.existsSync(path.join(tmpDir, '.codebuddy', 'specs', p.id, 'stories', `${story.id}.md`))).toBe(true);
    });
  });

  describe('state machine — legal transitions', () => {
    it('draft → approved (requires reviewer) → in_progress → done (requires evidence)', () => {
      const store = new SpecStore(tmpDir);
      const p = store.createProject('p');
      const s = newStory(store, p.id);

      const approved = store.approveStory(p.id, s.id, 'Patrice');
      expect(approved.status).toBe('approved');
      expect(approved.reviewedBy).toBe('Patrice');

      const started = store.startStory(p.id, s.id, { runId: 'run-1' });
      expect(started.status).toBe('in_progress');
      expect(started.lineage?.runId).toBe('run-1');

      const done = store.completeStory(p.id, s.id, 'npm test green');
      expect(done.status).toBe('done');
      expect(done.evidence).toBe('npm test green');
    });

    it('draft → blocked (requires reason) → draft (reopen clears reason)', () => {
      const store = new SpecStore(tmpDir);
      const p = store.createProject('p');
      const s = newStory(store, p.id);

      const blocked = store.blockStory(p.id, s.id, 'waiting on API key');
      expect(blocked.status).toBe('blocked');
      expect(blocked.blockedReason).toBe('waiting on API key');

      const reopened = store.reopenStory(p.id, s.id);
      expect(reopened.status).toBe('draft');
      expect(reopened.blockedReason).toBeUndefined();
    });

    it('approved → draft (revise) is allowed', () => {
      const store = new SpecStore(tmpDir);
      const p = store.createProject('p');
      const s = newStory(store, p.id);
      store.approveStory(p.id, s.id, 'r');
      expect(store.reopenStory(p.id, s.id).status).toBe('draft');
    });
  });

  describe('state machine — illegal transitions rejected', () => {
    it('cannot start or complete a draft story', () => {
      const store = new SpecStore(tmpDir);
      const p = store.createProject('p');
      const s = newStory(store, p.id);
      expect(() => store.startStory(p.id, s.id)).toThrow(SpecTransitionError);
      expect(() => store.completeStory(p.id, s.id, 'x')).toThrow(SpecTransitionError);
    });

    it('done is terminal', () => {
      const store = new SpecStore(tmpDir);
      const p = store.createProject('p');
      const s = newStory(store, p.id);
      store.approveStory(p.id, s.id, 'r');
      store.startStory(p.id, s.id);
      store.completeStory(p.id, s.id, 'evidence');
      expect(() => store.blockStory(p.id, s.id, 'x')).toThrow(SpecTransitionError);
      expect(() => store.reopenStory(p.id, s.id)).toThrow(SpecTransitionError);
    });

    it('requires reviewer / evidence / reason on the gated transitions', () => {
      const store = new SpecStore(tmpDir);
      const p = store.createProject('p');
      const s = newStory(store, p.id);
      expect(() => store.approveStory(p.id, s.id, '  ')).toThrow(/reviewer/i);
      store.approveStory(p.id, s.id, 'r');
      store.startStory(p.id, s.id);
      expect(() => store.completeStory(p.id, s.id, '  ')).toThrow(/evidence/i);
      expect(() => store.blockStory(p.id, s.id, '  ')).toThrow(/reason/i);
    });
  });

  describe('isLegalTransition', () => {
    it('matches the documented transition table', () => {
      expect(isLegalTransition('draft', 'approved')).toBe(true);
      expect(isLegalTransition('approved', 'in_progress')).toBe(true);
      expect(isLegalTransition('in_progress', 'done')).toBe(true);
      expect(isLegalTransition('blocked', 'draft')).toBe(true);
      // illegal
      expect(isLegalTransition('draft', 'done')).toBe(false);
      expect(isLegalTransition('done', 'draft')).toBe(false);
      expect(isLegalTransition('draft', 'in_progress')).toBe(false);
    });

    it('covers every declared status', () => {
      expect(SPEC_STORY_STATUSES).toEqual(['draft', 'approved', 'in_progress', 'done', 'blocked']);
    });
  });

  describe('persistence + derived sprint status', () => {
    it('round-trips stories across store instances and derives sprint status', () => {
      const store = new SpecStore(tmpDir);
      const p = store.createProject('p');
      const a = newStory(store, p.id, 'one');
      store.approveStory(p.id, a.id, 'r');
      const b = newStory(store, p.id, 'two');
      store.blockStory(p.id, b.id, 'later');

      const reloaded = new SpecStore(tmpDir);
      const status = reloaded.getSprintStatus(p.id);
      expect(status.total).toBe(2);
      expect(status.byStatus.approved).toBe(1);
      expect(status.byStatus.blocked).toBe(1);
      expect(reloaded.getStory(p.id, a.id)?.reviewedBy).toBe('r');
    });
  });

  describe('epics', () => {
    it('adds and lists epics', () => {
      const store = new SpecStore(tmpDir);
      const p = store.createProject('p');
      const e = store.addEpic(p.id, { title: 'Map layer', summary: 'render + move' });
      expect(e.id).toMatch(/^ep-/);
      expect(store.listEpics(p.id).map((x) => x.title)).toEqual(['Map layer']);
    });
  });

  describe('singleton accessor', () => {
    it('returns the same instance per workDir', () => {
      expect(getSpecStore(tmpDir)).toBe(getSpecStore(tmpDir));
    });
  });
});
