/**
 * Assistant-mode P5 (local): a calendar/agenda of reminders + "remind me BEFORE an event".
 * agendaFor / describeAgendaForSpeech / the agenda voice command / the lead-time parse are all pure
 * (no store), so they're tested directly; the handler uses injected list + clock.
 */
import { describe, it, expect } from 'vitest';
import {
  agendaFor,
  describeAgendaForSpeech,
  parseReminderCommand,
  parseVoiceReminder,
  handleReminderVoiceCommand,
  type Reminder,
} from '../../src/companion/reminders.js';

function rem(id: string, label: string, over: Partial<Reminder> = {}): Reminder {
  return { id, label, time: '09:00', enabled: true, createdAt: '2026-07-02T00:00:00Z', ...over };
}

const NOW = new Date(2026, 6, 2, 8, 0, 0).getTime(); // Thu 2 Jul 2026, 08:00 local

describe('agendaFor', () => {
  it('lists one-shot on its day + recurring per day in the window, chronological', () => {
    const list = [rem('a', 'train', { time: '10:38', date: '2026-07-03' }), rem('b', 'médicaments', { time: '09:00' })];
    const ag = agendaFor(list, NOW, 1);
    // today 09:00 (b), tomorrow 09:00 (b), tomorrow 10:38 (a)
    expect(ag.map((e) => e.label)).toEqual(['médicaments', 'médicaments', 'train']);
    expect(ag.every((e, i) => i === 0 || ag[i - 1]!.at <= e.at)).toBe(true); // sorted
    expect(ag.find((e) => e.label === 'train')!.recurring).toBe(false);
    expect(ag.find((e) => e.label === 'médicaments')!.recurring).toBe(true);
  });

  it('skips past occurrences (today already passed) but keeps the future one', () => {
    const ag = agendaFor([rem('c', 'matin', { time: '07:00' })], NOW, 1); // 07:00 < now 08:00
    expect(ag).toHaveLength(1); // only tomorrow 07:00
    expect(new Date(ag[0]!.at).getDate()).toBe(3);
  });

  it('skips disabled reminders and past one-shot dates', () => {
    expect(agendaFor([rem('d', 'off', { enabled: false })], NOW, 7)).toHaveLength(0);
    expect(agendaFor([rem('f', 'vieux', { date: '2026-06-01' })], NOW, 7)).toHaveLength(0);
  });

  it('respects the weekday mask', () => {
    const todayDow = new Date(NOW).getDay();
    const other = (todayDow + 1) % 7;
    // Today-only window: a reminder masked to TODAY's weekday appears; one masked to another day doesn't.
    expect(agendaFor([rem('e', 'jour', { days: [todayDow] })], NOW, 0)).toHaveLength(1);
    expect(agendaFor([rem('f', 'autre', { days: [other] })], NOW, 0)).toHaveLength(0);
  });
});

describe('describeAgendaForSpeech', () => {
  it('uses relative day words and a gentle none-line', () => {
    expect(describeAgendaForSpeech([], NOW)).toMatch(/rien de prévu/i);
    const list = [rem('a', 'train', { time: '10:38', date: '2026-07-03' }), rem('b', 'médicaments', { time: '09:00' })];
    const line = describeAgendaForSpeech(agendaFor(list, NOW, 1), NOW);
    expect(line).toContain("aujourd'hui");
    expect(line).toContain('demain');
    expect(line).toContain('train');
  });
});

describe('parseReminderCommand — agenda', () => {
  it('recognizes agenda queries and their window', () => {
    expect(parseReminderCommand("qu'est-ce que j'ai demain ?")).toEqual({ kind: 'agenda', days: 1 });
    expect(parseReminderCommand("qu'est-ce que j'ai aujourd'hui")).toEqual({ kind: 'agenda', days: 0 });
    expect(parseReminderCommand('mon agenda de la semaine')).toEqual({ kind: 'agenda', days: 7 });
  });
  it('does not confuse a plain list query with the agenda', () => {
    expect(parseReminderCommand('quels sont mes rappels')).toEqual({ kind: 'list' });
  });
});

describe('parseVoiceReminder — lead time (remind BEFORE the event)', () => {
  const now = new Date(2026, 6, 2);
  it('fires N minutes before the event and labels how far ahead', () => {
    const p = parseVoiceReminder('rappelle-moi 30 minutes avant le train à 10h38', now)!;
    expect(p.time).toBe('10:08');
    expect(p.label).toContain('train');
    expect(p.label).toContain('dans 30 minutes');
  });
  it('handles an hours lead', () => {
    const p = parseVoiceReminder('rappelle-moi 2 heures avant la réunion à 10h', now)!;
    expect(p.time).toBe('08:00');
    expect(p.label).toContain('dans 2 heures');
  });
  it('leaves the time unchanged without a lead', () => {
    const p = parseVoiceReminder('rappelle-moi le train à 10h38', now)!;
    expect(p.time).toBe('10:38');
    expect(p.label).not.toContain('dans');
  });
});

describe('handleReminderVoiceCommand — agenda', () => {
  it('speaks the upcoming agenda', async () => {
    const spoken: string[] = [];
    const list = [rem('a', 'train', { time: '10:38', date: '2026-07-03' })];
    const handled = await handleReminderVoiceCommand("qu'est-ce que j'ai demain", {
      speak: async (t) => void spoken.push(t),
      list: async () => list,
      now: NOW,
    });
    expect(handled).toBe(true);
    expect(spoken[0]).toContain('train');
    expect(spoken[0]).toContain('demain');
  });
});
