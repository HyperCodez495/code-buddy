import { describe, expect, it } from 'vitest';

import { formatSummary } from '../src/renderer/utils/toast-model';

describe('formatSummary', () => {
  it('formats a compact mission summary', () => {
    expect(formatSummary({ title: 'Recherche', durationMs: 65_000, deliverableCount: 2 })).toBe(
      'Recherche · 1m 5s · 2 livrable(s)'
    );
  });
});
