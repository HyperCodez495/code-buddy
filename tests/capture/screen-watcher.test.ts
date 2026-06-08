import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ScreenWatcher, redactSecrets, type Observation } from '../../src/capture/screen-watcher.js';

describe('redactSecrets (privacy-lint reuse)', () => {
  it('leaves clean text untouched', () => {
    const r = redactSecrets('just some normal screen text about the build');
    expect(r.redacted).toBe(false);
    expect(r.text).toBe('just some normal screen text about the build');
  });

  it('redacts a detected secret (JWT) from OCR text', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const r = redactSecrets(`logged token ${jwt} on screen`);
    expect(r.redacted).toBe(true);
    expect(r.text).toContain('[REDACTED:');
    expect(r.text).not.toContain(jwt);
  });
});

describe('ScreenWatcher dedup loop', () => {
  it('marks the first frame changed, an identical fingerprint idle, a new one changed', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'cb-watch-'));
    const fingerprints = ['A', 'A', 'B'];
    let i = 0;
    let clock = 1000;
    const observed: Observation[] = [];

    const watcher = new ScreenWatcher({
      outDir,
      capture: async (out) => out, // no real ffmpeg
      fingerprint: () => fingerprints[i++] ?? 'Z',
      now: () => (clock += 1),
      onObservation: (obs) => observed.push(obs),
    });

    await watcher.tick(); // fp A vs null → changed
    await watcher.tick(); // fp A vs A → idle
    await watcher.tick(); // fp B vs A → changed

    expect(observed.map((o) => o.changed)).toEqual([true, false, true]);
    // No OCR by default → no text.
    expect(observed.every((o) => o.text === undefined)).toBe(true);
  });

  it('runs OCR + redaction only on changed frames when ocr is enabled', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'cb-watch-'));
    const fps = ['X', 'X']; // second is idle
    let i = 0;
    const ocrCalls: string[] = [];
    const observed: Observation[] = [];

    const watcher = new ScreenWatcher({
      outDir,
      ocr: true,
      capture: async (out) => out,
      fingerprint: () => fps[i++] ?? 'Z',
      ocrImpl: async (p) => {
        ocrCalls.push(p);
        return 'secret 4539148803436467 visible'; // Luhn-valid card
      },
      onObservation: (obs) => observed.push(obs),
    });

    await watcher.tick(); // changed → OCR runs
    await watcher.tick(); // idle → OCR skipped

    expect(ocrCalls).toHaveLength(1); // only the changed frame
    expect(observed[0]?.text).toContain('[REDACTED:'); // card redacted
    expect(observed[0]?.redacted).toBe(true);
    expect(observed[1]?.text).toBeUndefined(); // idle frame, no OCR
  });
});
