import { describe, it, expect } from 'vitest';
import {
  CURATED_FEATURES,
  mergeFeatures,
  getFeatureMap,
  type FeatureArea,
} from '../../../../src/agent/self-improvement/evolution/feature-map.js';

describe('feature map — curated base', () => {
  it('every curated area is well-formed (id, name, description, paths)', () => {
    expect(CURATED_FEATURES.length).toBeGreaterThan(10);
    for (const f of CURATED_FEATURES) {
      expect(f.id).toBeTruthy();
      expect(f.name).toBeTruthy();
      expect(f.description.length).toBeGreaterThan(20);
      expect(Array.isArray(f.paths)).toBe(true);
    }
    // ids unique
    expect(new Set(CURATED_FEATURES.map((f) => f.id)).size).toBe(CURATED_FEATURES.length);
  });
});

describe('mergeFeatures', () => {
  const base: FeatureArea[] = [{ id: 'a', name: 'A', description: 'desc a', paths: ['x'] }];
  it('adds new areas and dedups by id (curated wins)', () => {
    const merged = mergeFeatures(base, [
      { id: 'b', name: 'B', description: 'desc b', paths: [] },
      { id: 'a', name: 'A-dup', description: 'other', paths: [] }, // dup → ignored
    ]);
    expect(merged.map((f) => f.id).sort()).toEqual(['a', 'b']);
    expect(merged.find((f) => f.id === 'a')!.name).toBe('A'); // curated kept
  });
  it('skips malformed extra entries', () => {
    const merged = mergeFeatures(base, [{ id: '', name: 'x', description: 'd', paths: [] } as FeatureArea]);
    expect(merged).toHaveLength(1);
  });
});

describe('getFeatureMap', () => {
  it('merges curated + injected enrichment', async () => {
    const map = await getFeatureMap({ enrich: async () => [{ id: 'ce:extra', name: 'Extra', description: 'from code explorer', paths: [] }] });
    expect(map.some((f) => f.id === 'ce:extra')).toBe(true);
    expect(map.length).toBe(CURATED_FEATURES.length + 1);
  });
  it('degrades to curated when enrichment throws', async () => {
    const map = await getFeatureMap({ enrich: async () => { throw new Error('no code explorer'); } });
    expect(map.length).toBe(CURATED_FEATURES.length);
  });
});
