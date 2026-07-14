import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ScreenWatcher,
  perceptualHashDistance,
  redactSecrets,
  type Observation,
} from '../../src/capture/screen-watcher.js';

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
  it('deduplicates real WebP pixels and notices a large colour change when Sharp is available', async () => {
    let sharp: typeof import('sharp').default;
    try {
      ({ default: sharp } = await import('sharp'));
    } catch {
      return;
    }
    const outDir = mkdtempSync(join(tmpdir(), 'cb-watch-webp-'));
    const colours = [
      { r: 220, g: 40, b: 40 },
      { r: 220, g: 40, b: 40 },
      { r: 30, g: 60, b: 220 },
    ];
    let index = 0;
    const watcher = new ScreenWatcher({
      outDir,
      capture: async (out) => {
        await sharp({
          create: { width: 64, height: 64, channels: 3, background: colours[index++]! },
        }).webp({ quality: index === 2 ? 65 : 85 }).toFile(out);
        return out;
      },
    });

    expect((await watcher.tick()).changed).toBe(true);
    expect((await watcher.tick()).changed).toBe(false);
    expect((await watcher.tick()).changed).toBe(true);
  });

  it('tolerates small visual hash changes but detects a materially different frame', async () => {
    expect(perceptualHashDistance('dhash:0000000000000000', 'dhash:0000000000000003')).toBe(2);
    expect(
      perceptualHashDistance(
        'dhash:0000000000000000:000000',
        'dhash:0000000000000000:ffffff',
      ),
    ).toBe(16);
    expect(perceptualHashDistance('sha256:a', 'sha256:b')).toBeNull();

    const outDir = mkdtempSync(join(tmpdir(), 'cb-watch-'));
    const fingerprints = [
      'dhash:0000000000000000',
      'dhash:0000000000000003',
      'dhash:ffffffffffffffff',
    ];
    let index = 0;
    const watcher = new ScreenWatcher({
      outDir,
      capture: async (out) => out,
      fingerprint: () => fingerprints[index++]!,
      perceptualHashThreshold: 2,
    });

    expect((await watcher.tick()).changed).toBe(true);
    expect((await watcher.tick()).changed).toBe(false);
    expect((await watcher.tick()).changed).toBe(true);
  });

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
    expect(observed.every((o) => o.framePath.endsWith('.webp'))).toBe(true);
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
