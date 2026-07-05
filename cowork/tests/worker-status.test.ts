import { describe, expect, it } from 'vitest';

import { formatUptime, healthLabel } from '../src/renderer/utils/worker-status';

describe('healthLabel', () => {
  it('marks offline workers as down', () => {
    expect(healthLabel({ online: false, uptimeSec: 0, activeMissions: 0, queuedMissions: 0, processedToday: 0, capacity: 4 })).toBe('down');
  });

  it('marks saturated workers as busy', () => {
    expect(healthLabel({ online: true, uptimeSec: 60, activeMissions: 3, queuedMissions: 1, processedToday: 12, capacity: 4 })).toBe('busy');
  });

  it('marks available workers as ok', () => {
    expect(healthLabel({ online: true, uptimeSec: 60, activeMissions: 1, queuedMissions: 0, processedToday: 12, capacity: 4 })).toBe('ok');
  });
});

describe('formatUptime', () => {
  it('formats minutes, hours and days', () => {
    expect(formatUptime(90)).toBe('1m');
    expect(formatUptime(3_900)).toBe('1h 5m');
    expect(formatUptime(90_000)).toBe('1d 1h');
  });
});
