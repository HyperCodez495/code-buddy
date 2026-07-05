import { describe, expect, it } from 'vitest';

import { summarizeFleet, utilizationTone, type Peer } from '../src/renderer/components/os/util/fleet-model.js';

const peers: Peer[] = [
  { id: 'a', label: 'Alpha', status: 'online', role: 'hub', utilization: 0.2, latencyMs: 40 },
  { id: 'b', label: 'Beta', status: 'busy', role: 'code', utilization: 0.7, latencyMs: 80 },
  { id: 'c', label: 'Gamma', status: 'offline', role: 'leaf', utilization: 0.9 },
];

describe('fleet-model', () => {
  it('summarizes peer status and measured latency', () => {
    expect(summarizeFleet(peers)).toEqual({ online: 1, busy: 1, offline: 1, avgLatency: 60 });
  });

  it('maps utilization to operational tones', () => {
    expect(utilizationTone(0.4)).toBe('ok');
    expect(utilizationTone(0.65)).toBe('warn');
    expect(utilizationTone(0.85)).toBe('critical');
  });
});
