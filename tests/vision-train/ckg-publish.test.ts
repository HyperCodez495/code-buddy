/**
 * vision-train CKG publish — real test (no mocks): a fake ingestor captures what
 * would be written; asserts weak spots become discovery nodes and a clean run
 * records a baseline. No ledger, no network.
 */
import { describe, expect, it } from 'vitest';
import { publishBenchmark, type CkgIngestor } from '../../src/vision-train/ckg-publish.js';
import { runVisionTrain } from '../../src/vision-train/engine.js';
import { buildCurriculum } from '../../src/vision-train/curriculum.js';

function fakeCkg(): { ckg: CkgIngestor; writes: Array<{ text: string; name?: string; source?: string; confidence?: number }> } {
  const writes: Array<{ text: string; name?: string; source?: string; confidence?: number }> = [];
  return {
    writes,
    ckg: {
      ingest: async (input) => {
        writes.push(input);
        return { id: `n${writes.length}` };
      },
    },
  };
}

describe('publishBenchmark', () => {
  it('writes one discovery per weak spot', async () => {
    const specs = buildCurriculum({ count: 6, prop: 'none' });
    const blind = await runVisionTrain(specs, {
      obtainImage: async (s) => `/i/${s.id}.png`,
      perceive: async () => ({ countsByLabel: {} }), // misses every person
    });
    const { ckg, writes } = fakeCkg();
    const n = await publishBenchmark(blind.benchmark, { source: 'test', model: 'yolov8n' }, ckg);
    expect(n).toBe(blind.benchmark.weakSpots.length);
    expect(n).toBeGreaterThan(0);
    expect(writes.every((w) => w.source === 'vision-train')).toBe(true);
    expect(writes.some((w) => /weakness/i.test(w.text))).toBe(true);
    // confidence stays within [0,1]
    expect(writes.every((w) => (w.confidence ?? 0) >= 0 && (w.confidence ?? 0) <= 1)).toBe(true);
  });

  it('records a baseline when perception is perfect', async () => {
    const specs = buildCurriculum({ count: 4, prop: 'none' });
    const perfect = await runVisionTrain(specs, {
      obtainImage: async (s) => `/i/${s.id}.png`,
      perceive: async (_p, spec) => ({ countsByLabel: { ...spec.expect.counts } }),
    });
    const { ckg, writes } = fakeCkg();
    const n = await publishBenchmark(perfect.benchmark, { source: 'test' }, ckg);
    expect(n).toBe(1);
    expect(writes[0]!.text).toMatch(/matched ground truth/i);
  });

  it('writes nothing for an empty benchmark', async () => {
    const { ckg, writes } = fakeCkg();
    const n = await publishBenchmark(
      { scenes: 0, accuracy: 0, meanCountError: 0, perLabel: [], perTag: [], weakSpots: [] },
      { source: 'test' },
      ckg,
    );
    expect(n).toBe(0);
    expect(writes).toHaveLength(0);
  });
});
