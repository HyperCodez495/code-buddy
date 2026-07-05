/**
 * vision-train scorer + curriculum — real tests (no mocks): scoring perception
 * against ground truth, aggregate precision/recall, weakness detection, and the
 * deterministic domain-randomized curriculum.
 */
import { describe, expect, it } from 'vitest';
import { scoreScene, aggregate } from '../../src/vision-train/scorer.js';
import { buildCurriculum } from '../../src/vision-train/curriculum.js';

describe('scoreScene', () => {
  it('marks a perfect match correct with zero count error', () => {
    const s = scoreScene('a', { counts: { person: 1, desk: 1 } }, { countsByLabel: { person: 1, desk: 1 } }, ['bright']);
    expect(s.correct).toBe(true);
    expect(s.countError).toBe(0);
  });

  it('flags a missed person as a false negative', () => {
    const s = scoreScene('b', { counts: { person: 2 } }, { countsByLabel: { person: 1 } });
    expect(s.correct).toBe(false);
    expect(s.countError).toBe(1);
    const person = s.labels.find((l) => l.label === 'person')!;
    expect(person.falseNegatives).toBe(1);
    expect(person.truePositives).toBe(1);
  });

  it('flags a hallucinated person (empty scene) as a false positive', () => {
    const s = scoreScene('c', { counts: {} }, { countsByLabel: { person: 1 } });
    expect(s.correct).toBe(false);
    const person = s.labels.find((l) => l.label === 'person')!;
    expect(person.falsePositives).toBe(1);
    expect(person.expected).toBe(0);
  });
});

describe('aggregate', () => {
  it('computes accuracy, per-label precision/recall and mean count error', () => {
    const scores = [
      scoreScene('1', { counts: { person: 1 } }, { countsByLabel: { person: 1 } }, ['bright']),
      scoreScene('2', { counts: { person: 1 } }, { countsByLabel: {} }, ['low-light']), // miss
      scoreScene('3', { counts: {} }, { countsByLabel: { person: 1 } }, ['low-light']), // hallucinate
      scoreScene('4', { counts: { person: 2 } }, { countsByLabel: { person: 2 } }, ['bright']),
    ];
    const b = aggregate(scores);
    expect(b.scenes).toBe(4);
    expect(b.accuracy).toBeCloseTo(0.5); // scenes 1 & 4 correct
    const person = b.perLabel.find((m) => m.label === 'person')!;
    // support = 1+1+0+2 = 4 ; detected = 1+0+1+2 = 4 ; tp = 1+0+0+2 = 3
    expect(person.support).toBe(4);
    expect(person.detected).toBe(4);
    expect(person.recall).toBeCloseTo(0.75);
    expect(person.precision).toBeCloseTo(0.75);
    expect(b.meanCountError).toBeCloseTo(0.5); // (0+1+1+0)/4
  });

  it('surfaces low recall and a struggling tag as weak spots', () => {
    const scores = [
      // low-light: all missed → recall low + tag weak
      scoreScene('1', { counts: { person: 1 } }, { countsByLabel: {} }, ['low-light']),
      scoreScene('2', { counts: { person: 1 } }, { countsByLabel: {} }, ['low-light']),
      // bright: all correct
      scoreScene('3', { counts: { person: 1 } }, { countsByLabel: { person: 1 } }, ['bright']),
      scoreScene('4', { counts: { person: 1 } }, { countsByLabel: { person: 1 } }, ['bright']),
    ];
    const b = aggregate(scores);
    expect(b.weakSpots.length).toBeGreaterThan(0);
    expect(b.weakSpots.some((w) => /Misses "person"/.test(w))).toBe(true);
    expect(b.weakSpots.some((w) => /low-light/.test(w))).toBe(true);
    // the low-light tag scores below overall
    const lowLight = b.perTag.find((t) => t.tag === 'low-light')!;
    expect(lowLight.accuracy).toBe(0);
  });

  it('handles an empty run without dividing by zero', () => {
    const b = aggregate([]);
    expect(b.scenes).toBe(0);
    expect(b.accuracy).toBe(0);
    expect(b.weakSpots).toEqual([]);
  });
});

describe('buildCurriculum', () => {
  it('is deterministic and self-labeled', () => {
    const a = buildCurriculum({ count: 8 });
    const b = buildCurriculum({ count: 8 });
    expect(a).toEqual(b); // reproducible
    expect(a).toHaveLength(8);
    for (const scene of a) {
      expect(scene.prompt.length).toBeGreaterThan(10);
      expect(Array.isArray(scene.tags)).toBe(true);
      // person scenes carry a person count; empty scenes carry none
      if (scene.tags.includes('empty')) {
        expect(scene.expect.counts.person).toBeUndefined();
      } else {
        expect(scene.expect.counts.person).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('adds a labeled prop to peopled scenes and rotates lighting', () => {
    const scenes = buildCurriculum({ count: 4, prop: 'chair' });
    const peopled = scenes.filter((s) => !s.tags.includes('empty'));
    expect(peopled.every((s) => s.expect.counts.chair === 1)).toBe(true);
    const tags = new Set(scenes.flatMap((s) => s.tags));
    expect(tags.has('bright')).toBe(true);
    expect(tags.has('low-light')).toBe(true);
  });

  it('clamps count to a sane range', () => {
    expect(buildCurriculum({ count: 0 })).toHaveLength(1);
    expect(buildCurriculum({ count: 999 })).toHaveLength(200);
  });
});
