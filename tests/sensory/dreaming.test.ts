import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { consolidate, runDreamingPass } from '../../src/sensory/dreaming.js';
import { getSensoryMemory } from '../../src/sensory/sensory-memory.js';
import type { Perception } from '../../src/sensory/reactions.js';

describe('dreaming — heartbeat-paced memory consolidation', () => {
  it('consolidates a window of perceptions (counts, salient, avg load, span)', () => {
    const window: Perception[] = [
      { modality: 'vital', kind: 'heartbeat', salience: 5, tsMs: 100, payload: { load1: 0.4 } },
      { modality: 'vital', kind: 'heartbeat', salience: 5, tsMs: 200, payload: { load1: 0.6 } },
      { modality: 'audio', kind: 'speech_start', salience: 200, tsMs: 150, payload: {} },
    ];
    const d = consolidate(window, 9999);
    expect(d.total).toBe(3);
    expect(d.byKind['vital/heartbeat']).toBe(2);
    expect(d.byKind['audio/speech_start']).toBe(1);
    expect(d.salient).toHaveLength(1); // only speech is salient
    expect(d.salient[0]!.kind).toBe('speech_start');
    expect(d.avgLoad).toBeCloseTo(0.5);
    expect(d.windowStartMs).toBe(100);
    expect(d.windowEndMs).toBe(200);
    expect(d.dreamedAt).toBe(9999);
  });

  it('a dreaming pass drains short-term memory and writes a dream record', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'dream-'));
    const mem = getSensoryMemory();
    mem.push({ modality: 'vital', kind: 'heartbeat', salience: 5, tsMs: 1, payload: { load1: 0.3 } });
    mem.push({ modality: 'audio', kind: 'speech_end', salience: 200, tsMs: 2 });

    const summary = await runDreamingPass({ cwd: tmp, now: 123 });
    expect(summary).not.toBeNull();
    expect(summary!.total).toBe(2);
    expect(mem.size()).toBe(0); // drained — the window was consumed

    const journal = await readFile(path.join(tmp, '.codebuddy', 'companion', 'dreams.jsonl'), 'utf8');
    expect(journal).toContain('"total":2');
    expect(journal).toContain('"dreamedAt":123');

    // Nothing left to consolidate → null (no empty dreams).
    expect(await runDreamingPass({ cwd: tmp })).toBeNull();
  });
});
