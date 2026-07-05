import { describe, expect, it } from 'vitest';

import { privacyImpact, rankAlternatives } from '../src/renderer/components/os-actions/utils/route-override-model.js';

describe('route-override-model', () => {
  it('ranks available low-cost low-latency alternatives first', () => {
    const ranked = rankAlternatives([
      { id: 'slow', label: 'Slow', targetType: 'model', costUsd: 0.2, latencyMs: 2000, privacyTier: 'low', available: true },
      { id: 'fast', label: 'Fast', targetType: 'peer', costUsd: 0.01, latencyMs: 100, privacyTier: 'low', available: true },
      { id: 'off', label: 'Off', targetType: 'peer', costUsd: 0, latencyMs: 1, privacyTier: 'low', available: false },
    ]);
    expect(ranked.map((item) => item.id)).toEqual(['fast', 'slow', 'off']);
  });

  it('describes high privacy exposure', () => {
    expect(privacyImpact({ targetType: 'peer', privacyTier: 'high' })).toContain('sensibles');
  });
});
