/**
 * Assistant-mode P3: snooze a fired reminder — "rappelle-moi dans 10 minutes" / "plus tard" while a
 * reminder is pending re-announces it later instead of letting it re-nag then lapse to "missed".
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { rm } from 'node:fs/promises';
import {
  parseSnooze,
  snoozePending,
  isSnoozeCommand,
  snoozeReminder,
  dueSnoozes,
  resetSnoozes,
  resetAcks,
  openAck,
  pendingAcks,
  addReminder,
} from '../../src/companion/reminders.js';
import { runReminderTick } from '../../src/companion/reminder-runner.js';

let dir: string;
let counter = 0;
beforeEach(() => {
  dir = path.join(os.tmpdir(), `cb-snooze-${process.pid}-${counter++}`);
  process.env.CODEBUDDY_REMINDERS_FILE = path.join(dir, 'reminders.json');
  process.env.CODEBUDDY_REMINDER_LOG_FILE = path.join(dir, 'log.jsonl');
  process.env.CODEBUDDY_REMINDER_ACK_WINDOW_MS = '300000';
  resetAcks();
  resetSnoozes();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.CODEBUDDY_REMINDERS_FILE;
  delete process.env.CODEBUDDY_REMINDER_LOG_FILE;
  delete process.env.CODEBUDDY_REMINDER_ACK_WINDOW_MS;
});

describe('parseSnooze', () => {
  it('parses explicit and bare deferrals', () => {
    expect(parseSnooze('dans 10 minutes')).toBe(10 * 60_000);
    expect(parseSnooze('rappelle-moi dans 20 min')).toBe(20 * 60_000);
    expect(parseSnooze('dans 2 heures')).toBe(2 * 3600_000);
    expect(parseSnooze('plus tard')).toBe(10 * 60_000);
    expect(parseSnooze('repousse')).toBe(10 * 60_000);
  });
  it('returns null for non-snooze text', () => {
    expect(parseSnooze('bonjour Lisa')).toBeNull();
    expect(parseSnooze("c'est fait")).toBeNull();
    expect(parseSnooze('dans 50 heures')).toBeNull(); // out of range
  });
});

describe('snoozePending / isSnoozeCommand', () => {
  it('does nothing when no reminder is pending', () => {
    expect(snoozePending('dans 10 minutes', 1000)).toBeNull();
    expect(isSnoozeCommand('dans 10 minutes', 1000)).toBe(false);
  });
  it('defers the pending reminder, closing its ack and scheduling a re-announce', () => {
    openAck({ id: 'r1', label: 'médicaments' }, 1000);
    expect(isSnoozeCommand('dans 15 minutes', 1000)).toBe(true);
    const res = snoozePending('dans 15 minutes', 1000);
    expect(res).toMatchObject({ id: 'r1', label: 'médicaments', delayMs: 15 * 60_000 });
    expect(pendingAcks(1000)).toHaveLength(0); // ack closed → no re-nag/missed
    expect(dueSnoozes(1000 + 15 * 60_000)).toEqual([{ id: 'r1', label: 'médicaments' }]); // due later
  });
});

describe('dueSnoozes', () => {
  it('returns and removes only the due ones', () => {
    snoozeReminder('a', 'A', 1000);
    snoozeReminder('b', 'B', 5000);
    expect(dueSnoozes(2000)).toEqual([{ id: 'a', label: 'A' }]);
    expect(dueSnoozes(2000)).toEqual([]); // 'a' was removed
    expect(dueSnoozes(6000)).toEqual([{ id: 'b', label: 'B' }]);
  });
});

describe('runReminderTick re-announces a due snooze', () => {
  it('re-speaks the reminder and reopens the ack when the deferral elapses', async () => {
    const r = await addReminder({ label: 'médicaments', time: '23:59' }); // not due at our epoch clock
    const spoken: string[] = [];
    const deps = { say: async (t: string) => void spoken.push(t), notify: async () => {} };
    snoozeReminder(r.id, r.label, 1000);

    await runReminderTick(new Date(500), deps); // before the deferral → nothing
    expect(spoken).toHaveLength(0);

    await runReminderTick(new Date(1500), deps); // after → re-announced
    expect(spoken.some((s) => /médicaments/i.test(s))).toBe(true);
    expect(pendingAcks(1500)).toHaveLength(1); // a fresh ack cycle opened
  });
});
