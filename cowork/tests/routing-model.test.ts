import { describe, expect, it } from 'vitest';

import { formatLatency, privacyFlag } from '../src/renderer/utils/routing-model';

describe('privacyFlag', () => {
  it('warns on sensitive routes', () => {
    expect(privacyFlag({ target: 'peer', reason: '', costUsd: 0, latencyMs: 0, privacy: 'sensitive' })).toBe('warn');
  });

  it('allows internal routes', () => {
    expect(privacyFlag({ target: 'local', reason: '', costUsd: 0, latencyMs: 0, privacy: 'internal' })).toBe('ok');
  });
});

describe('formatLatency', () => {
  it('formats milliseconds and seconds', () => {
    expect(formatLatency(120)).toBe('120ms');
    expect(formatLatency(1234)).toBe('1.2s');
  });
});
