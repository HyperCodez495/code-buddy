import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  getCalendarEvents: vi.fn(),
}));

vi.mock('../../src/nodes/device-node.js', () => ({
  DeviceNodeManager: {
    getInstance: () => ({
      getCalendarEvents: hoisted.getCalendarEvents,
    }),
  },
}));

import { DeviceTool } from '../../src/tools/device-tool.js';

describe('DeviceTool calendar action', () => {
  beforeEach(() => {
    hoisted.getCalendarEvents.mockReset();
  });

  it('returns structured device calendar evidence to the agent', async () => {
    hoisted.getCalendarEvents.mockResolvedValue([{
      id: 'event-1',
      title: 'Déjeuner',
      start: '2026-07-15T10:00:00.000Z',
      end: '2026-07-15T11:00:00.000Z',
      allDay: false,
    }]);

    const result = await new DeviceTool().execute({
      action: 'calendar',
      deviceId: 'phone-1',
      days: 3,
    });

    expect(result.success).toBe(true);
    expect(JSON.parse(result.output ?? '{}')).toMatchObject({
      source: 'device:phone-1',
      periodDays: 3,
      events: [{ id: 'event-1', title: 'Déjeuner' }],
    });
    expect(hoisted.getCalendarEvents).toHaveBeenCalledWith('phone-1', 3);
  });

  it('keeps permission failure distinct from an empty calendar', async () => {
    hoisted.getCalendarEvents.mockResolvedValueOnce(null);
    const failed = await new DeviceTool().execute({ action: 'calendar', deviceId: 'phone-1' });
    hoisted.getCalendarEvents.mockResolvedValueOnce([]);
    const empty = await new DeviceTool().execute({ action: 'calendar', deviceId: 'phone-1' });

    expect(failed).toMatchObject({ success: false });
    expect(failed.error).toContain('Calendar unavailable');
    expect(empty).toEqual({
      success: true,
      output: 'No calendar events found in the requested period.',
    });
  });
});
