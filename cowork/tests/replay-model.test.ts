import { describe, expect, it } from 'vitest';

import { buildTimeline, eventAt, type RunEvent } from '../src/renderer/utils/replay-model';

const events: RunEvent[] = [
  { id: 'b', atMs: 2000, type: 'tool', label: 'Tool' },
  { id: 'a', atMs: 1000, type: 'message', label: 'Start' },
];

describe('buildTimeline', () => {
  it('sorts events into marks', () => {
    expect(buildTimeline(events).map((mark) => mark.id)).toEqual(['a', 'b']);
  });
});

describe('eventAt', () => {
  it('returns the latest event at or before a timestamp', () => {
    expect(eventAt(events, 1500)?.id).toBe('a');
    expect(eventAt(events, 2500)?.id).toBe('b');
  });

  it('returns null before the first event', () => {
    expect(eventAt(events, 500)).toBeNull();
  });
});
