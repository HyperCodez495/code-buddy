/**
 * vision-train engine + report — real tests (no mocks): the loop drives injected
 * obtainImage/perceive, scores each scene, aggregates, and records per-scene
 * failures without aborting. Report rendering is asserted on real content.
 */
import { describe, expect, it } from 'vitest';
import { runVisionTrain } from '../../src/vision-train/engine.js';
import { renderReport } from '../../src/vision-train/report.js';
import { buildCurriculum } from '../../src/vision-train/curriculum.js';
import type { ScenePerception } from '../../src/vision-train/scorer.js';

describe('runVisionTrain', () => {
  it('drives obtain→perceive→score over the curriculum and aggregates', async () => {
    const specs = buildCurriculum({ count: 4, prop: 'none' });
    const seen: string[] = [];
    const result = await runVisionTrain(specs, {
      obtainImage: async (spec, i) => `/imgs/${spec.id}-${i}.png`,
      // Perfect perception: echo the ground truth back.
      perceive: async (imagePath, spec): Promise<ScenePerception> => {
        seen.push(imagePath);
        return { countsByLabel: { ...spec.expect.counts } };
      },
    });
    expect(seen).toHaveLength(4);
    expect(result.failures).toHaveLength(0);
    expect(result.benchmark.scenes).toBe(4);
    expect(result.benchmark.accuracy).toBe(1); // perfect perception
  });

  it('records a per-scene failure and continues the run', async () => {
    const specs = buildCurriculum({ count: 3, prop: 'none' });
    const result = await runVisionTrain(specs, {
      obtainImage: async (spec, i) => {
        if (i === 1) throw new Error('generation timed out');
        return `/imgs/${spec.id}.png`;
      },
      perceive: async (_p, spec) => ({ countsByLabel: { ...spec.expect.counts } }),
    });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.error).toMatch(/timed out/);
    expect(result.benchmark.scenes).toBe(2); // the two that succeeded
  });

  it('detects a systematic perception weakness (misses all persons)', async () => {
    const specs = buildCurriculum({ count: 6, prop: 'none' });
    const result = await runVisionTrain(specs, {
      obtainImage: async (spec) => `/imgs/${spec.id}.png`,
      // Blind perception: never reports a person.
      perceive: async () => ({ countsByLabel: {} }),
    });
    const peopled = specs.filter((s) => !s.tags.includes('empty')).length;
    expect(peopled).toBeGreaterThan(0);
    expect(result.benchmark.weakSpots.some((w) => /Misses "person"/.test(w))).toBe(true);
  });
});

describe('renderReport', () => {
  it('renders scenes, weak spots and per-label tables', async () => {
    const specs = buildCurriculum({ count: 4, prop: 'none' });
    const result = await runVisionTrain(specs, {
      obtainImage: async (spec) => `/imgs/${spec.id}.png`,
      perceive: async () => ({ countsByLabel: {} }), // blind → weak spot
    });
    const md = renderReport(result.benchmark, { source: 'test', model: 'yolov8n' });
    expect(md).toContain('# Vision-training perception benchmark');
    expect(md).toContain('Perception model: yolov8n');
    expect(md).toContain('Weak spots');
    expect(md).toMatch(/\| label \|/);
  });
});
