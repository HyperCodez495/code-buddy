import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TurnJournal } from '../src/main/session/turn-journal';

describe('TurnJournal deduplication', () => {
  it('collapses duplicated event lines by eventId and runId/seq when reading', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-journal-dedup-'));
    const journal = new TurnJournal(dir);

    const event = {
      schemaVersion: 1 as const,
      type: 'turn_started' as const,
      sessionId: 's1',
      ts: 1,
      eventId: 'evt-1',
      runId: 'run-1',
      seq: 1,
      turnId: 'turn-1',
    };
    const file = journal.pathFor('s1');
    fs.writeFileSync(file, `${JSON.stringify(event)}\n${JSON.stringify(event)}\n`, 'utf8');

    const result = journal.read('s1');

    expect(result.totalEventCount).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]?.eventCount).toBe(1);
    expect(result.replay.runCount).toBe(1);
    expect(result.replay.runs[0]?.anchors).toHaveLength(1);
    expect(result.replay.runs[0]?.anchors[0]?.eventId).toBe('evt-1');
  });

  it('keeps older events without seq distinct when their payload differs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-journal-legacy-'));
    const journal = new TurnJournal(dir);

    const first = {
      schemaVersion: 1 as const,
      type: 'trace_update' as const,
      sessionId: 's1',
      ts: 1,
      turnId: 'turn-1',
      data: { kind: 'legacy-1' },
    };
    const second = {
      schemaVersion: 1 as const,
      type: 'trace_update' as const,
      sessionId: 's1',
      ts: 2,
      turnId: 'turn-1',
      data: { kind: 'legacy-2' },
    };
    const file = journal.pathFor('s1');
    fs.writeFileSync(file, `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`, 'utf8');

    const result = journal.read('s1');

    expect(result.totalEventCount).toBe(2);
    expect(result.events).toHaveLength(2);
    expect(result.replay.runs[0]?.anchors).toHaveLength(2);
  });
});
