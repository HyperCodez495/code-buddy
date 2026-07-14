import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { wireSensoryWorkspace } from '../../src/cognition/sensory-workspace.js';
import { getGlobalEventBus, resetEventBus } from '../../src/events/event-bus.js';

describe('sensory cognitive workspace shadow adapter', () => {
  beforeEach(() => resetEventBus());
  afterEach(() => resetEventBus());

  it('publishes only safe local metadata and derives deterministic world facts', async () => {
    const cognition = wireSensoryWorkspace({ worldSweepMs: 0 });
    try {
      getGlobalEventBus().emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'vision',
          kind: 'person_entered',
          salience: 200,
          payload: {
            imagePath: '/private/camera/frame.jpg',
            base64: 'secret-image',
            transcript: 'private words',
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const items = cognition.workspace.snapshot();
      expect(items.map((item) => item.kind)).toEqual(expect.arrayContaining(['percept', 'fact']));
      expect(items.every((item) => item.privacy === 'local-only')).toBe(true);
      const serialized = JSON.stringify(items);
      expect(serialized).not.toContain('/private/camera');
      expect(serialized).not.toContain('secret-image');
      expect(serialized).not.toContain('private words');
      expect(serialized).toContain('"visibility":"visible"');
      expect(serialized).toContain('"firstSeen"');

      getGlobalEventBus().emit('sensory:perception', {
        source: 'test',
        metadata: { modality: 'vision', kind: 'person_left', salience: 120, payload: {} },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const facts = cognition.workspace.snapshot({ kinds: ['fact'] });
      expect(facts).toHaveLength(1);
      expect(facts[0]?.payload).toMatchObject({ visibility: 'absent' });
      expect(cognition.worldModel.get('person-occupancy:primary')?.visibility).toBe('absent');

      const changed = cognition.sweepWorld(Date.now() + 60_000);
      expect(changed).toHaveLength(1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const unknownFacts = cognition.workspace.snapshot({ kinds: ['fact'] });
      expect(unknownFacts).toHaveLength(1);
      expect(unknownFacts[0]?.payload).toMatchObject({ visibility: 'unknown' });
    } finally {
      cognition.close();
    }
  });

  it('keeps anonymous occupancy separate per camera and ignores non-transition vision', async () => {
    const cognition = wireSensoryWorkspace({ worldSweepMs: 0 });
    try {
      for (const camera of ['Brio Front', 'Kitchen Cam']) {
        getGlobalEventBus().emit('sensory:perception', {
          source: 'test',
          metadata: {
            modality: 'vision',
            kind: 'person_entered',
            salience: 200,
            payload: { camera },
          },
        });
      }
      getGlobalEventBus().emit('sensory:perception', {
        source: 'test',
        metadata: { modality: 'vision', kind: 'drowsy', salience: 220, payload: { camera: 'Other' } },
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(cognition.snapshotWorld().map((entity) => entity.id).sort()).toEqual([
        'person-occupancy:brio-front',
        'person-occupancy:kitchen-cam',
      ]);
    } finally {
      cognition.close();
    }
  });
});
