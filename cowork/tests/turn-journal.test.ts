import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TurnJournal } from '../src/main/session/turn-journal';

const tempDirs: string[] = [];

function makeJournal(): TurnJournal {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-turn-journal-'));
  tempDirs.push(dir);
  return new TurnJournal(dir);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('TurnJournal', () => {
  it('reads append-only turn events into recent events and turn summaries', () => {
    const journal = makeJournal();
    journal.append('s1', 'turn_submitted', { messageId: 'm1' }, 'turn-1');
    journal.append('s1', 'turn_started', { promptPreview: 'inspect auth' }, 'turn-1');
    journal.append('s1', 'message_saved', { messageId: 'm1', role: 'user' }, 'turn-1');
    journal.append('s1', 'trace_step', { stepId: 'step-1' }, 'turn-1');
    journal.append('s1', 'turn_completed', {}, 'turn-1');

    const result = journal.read('s1');

    expect(result.exists).toBe(true);
    expect(result.totalEventCount).toBe(5);
    expect(result.malformedLineCount).toBe(0);
    expect(result.pendingTurnCount).toBe(0);
    expect(result.events.map((event) => event.type)).toEqual([
      'turn_submitted',
      'turn_started',
      'message_saved',
      'trace_step',
      'turn_completed',
    ]);
    expect(result.turns[0]).toMatchObject({
      turnId: 'turn-1',
      latestType: 'turn_completed',
      status: 'completed',
      eventCount: 5,
      messageCount: 1,
      traceStepCount: 1,
    });
  });

  it('tolerates malformed lines and unrelated session records', () => {
    const journal = makeJournal();
    journal.append('s1', 'turn_started', {}, 'turn-1');
    fs.appendFileSync(journal.pathFor('s1'), 'not-json\n', 'utf8');
    fs.appendFileSync(
      journal.pathFor('s1'),
      `${JSON.stringify({
        schemaVersion: 1,
        type: 'turn_started',
        sessionId: 'other',
        ts: Date.now(),
      })}\n`,
      'utf8'
    );

    const result = journal.read('s1');

    expect(result.totalEventCount).toBe(1);
    expect(result.malformedLineCount).toBe(2);
    expect(result.turns[0]?.status).toBe('running');
  });

  it('survives a truncated partial write at the end of the journal', () => {
    const journal = makeJournal();
    journal.append('s1', 'turn_started', { promptPreview: 'inspect' }, 'turn-1');
    fs.appendFileSync(
      journal.pathFor('s1'),
      '{"schemaVersion":1,"type":"message_saved","sessionId":"s1","ts":',
      'utf8'
    );

    const result = journal.read('s1');

    expect(result.totalEventCount).toBe(1);
    expect(result.malformedLineCount).toBe(1);
    expect(result.replay.runCount).toBe(1);
    expect(result.replay.runs[0]?.anchors).toHaveLength(1);
  });

  it('caps returned recent events without losing total counts', () => {
    const journal = makeJournal();
    journal.append('s1', 'turn_started', {}, 'turn-1');
    journal.append('s1', 'message_saved', { messageId: 'm1' }, 'turn-1');
    journal.append('s1', 'turn_failed', { error: 'boom' }, 'turn-1');

    const result = journal.read('s1', 2);

    expect(result.totalEventCount).toBe(3);
    expect(result.events.map((event) => event.type)).toEqual(['message_saved', 'turn_failed']);
    expect(result.pendingTurnCount).toBe(0);
    expect(result.turns[0]?.status).toBe('failed');
  });
});
