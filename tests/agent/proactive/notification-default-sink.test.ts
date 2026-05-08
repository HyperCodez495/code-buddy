/**
 * notification-default-sink tests — Phase (d).21 ship 3.
 *
 * Validates the wake-up of NotificationManager:
 *   - notify() returns true for allowed messages, false when gated
 *   - default sink emits 'notification:emitted' on the manager bus
 *   - rate limit (maxPerHour) gates further messages
 *   - quiet hours gate low priority
 *   - notifyQuick() shorthand uses 'cli' channel
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  notify,
  notifyQuick,
  wireDefaultNotificationSink,
  _resetForTests,
} from '../../../src/agent/proactive/notification-default-sink.js';
import {
  getNotificationManager,
  resetNotificationManager,
} from '../../../src/agent/proactive/notification-manager.js';

beforeEach(() => {
  _resetForTests();
  resetNotificationManager();
});

describe('notification-default-sink', () => {
  it('wireDefaultNotificationSink is idempotent', () => {
    wireDefaultNotificationSink();
    wireDefaultNotificationSink();
    // No throw — check the manager exists and is queryable.
    expect(getNotificationManager().getStats().totalSent).toBe(0);
  });

  it('notify() returns true and emits notification:emitted when allowed', () => {
    wireDefaultNotificationSink();
    const mgr = getNotificationManager({ channels: ['cli'], maxPerHour: 100 });
    const seen: string[] = [];
    mgr.on('notification:emitted', (msg) => seen.push((msg as { message: string }).message));

    const ok = notify({
      channelType: 'cli',
      channelId: 'test',
      message: 'hello',
      priority: 'normal',
    });
    expect(ok).toBe(true);
    expect(seen).toEqual(['hello']);
    expect(mgr.getStats().totalSent).toBe(1);
  });

  it('notify() returns false (no emit) when channel not enabled', () => {
    getNotificationManager({ channels: ['telegram'], maxPerHour: 100 });
    const ok = notify({
      channelType: 'cli',
      channelId: 'test',
      message: 'blocked',
      priority: 'normal',
    });
    expect(ok).toBe(false);
  });

  it('notify() returns false when rate limit exceeded', () => {
    const mgr = getNotificationManager({ channels: ['cli'], maxPerHour: 2 });
    expect(notify({ channelType: 'cli', channelId: 't', message: 'a', priority: 'low' })).toBe(true);
    expect(notify({ channelType: 'cli', channelId: 't', message: 'b', priority: 'low' })).toBe(true);
    // 3rd within the hour → gated
    expect(notify({ channelType: 'cli', channelId: 't', message: 'c', priority: 'low' })).toBe(false);
    // History counts ALL attempts (including gated). Use deliveryRate for delivered ratio.
    expect(mgr.getStats().totalSent).toBe(3);
    expect(mgr.getStats().deliveryRate).toBeCloseTo(2 / 3, 2);
  });

  it('notify() respects quiet hours when priority is below threshold', () => {
    const now = new Date();
    const hour = now.getHours();
    // Set quiet hours to include the current hour (start = hour, end = hour+1).
    // Wraps midnight if hour=23 → start=23, end=0 → still includes 23.
    getNotificationManager({
      channels: ['cli'],
      quietHoursStart: hour,
      quietHoursEnd: (hour + 1) % 24,
      quietHoursMinPriority: 'high',
      maxPerHour: 100,
    });
    const lowResult = notify({
      channelType: 'cli',
      channelId: 't',
      message: 'low during quiet',
      priority: 'low',
    });
    expect(lowResult).toBe(false);
    const highResult = notify({
      channelType: 'cli',
      channelId: 't',
      message: 'high during quiet',
      priority: 'urgent',
    });
    expect(highResult).toBe(true);
  });

  it('notifyQuick() defaults to cli channel + normal priority', () => {
    getNotificationManager({ channels: ['cli'], maxPerHour: 10 });
    const ok = notifyQuick('quick message');
    expect(ok).toBe(true);
    const history = getNotificationManager().getHistory(10);
    expect(history.at(-1)?.channelType).toBe('cli');
    expect(history.at(-1)?.priority).toBe('normal');
  });

  it('notifyQuick() honours custom priority', () => {
    getNotificationManager({ channels: ['cli'], maxPerHour: 10 });
    notifyQuick('urgent thing', 'urgent');
    const history = getNotificationManager().getHistory(10);
    expect(history.at(-1)?.priority).toBe('urgent');
  });

  it('gated calls still record (with delivered=false) for accurate stats', () => {
    getNotificationManager({ channels: ['discord'], maxPerHour: 100 });
    notify({ channelType: 'cli', channelId: 't', message: 'gated', priority: 'normal' });
    const history = getNotificationManager().getHistory(10);
    expect(history.length).toBe(1);
    expect(history[0].delivered).toBe(false);
    // totalSent counts attempts; deliveryRate is what reflects gating.
    expect(getNotificationManager().getStats().deliveryRate).toBe(0);
  });
});
