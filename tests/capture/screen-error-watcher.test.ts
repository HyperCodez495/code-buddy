import { describe, it, expect } from 'vitest';
import { detectError, ScreenErrorWatcher } from '../../src/capture/screen-error-watcher.js';
import type { Observation } from '../../src/capture/screen-watcher.js';
import type { FaultLocalizationResult } from '../../src/agent/repair/types.js';

describe('detectError', () => {
  it('detects common errors / stack traces', () => {
    expect(detectError('src/x.ts(12,3): error TS2345: type mismatch')?.pattern).toBe('ts-error');
    expect(detectError('TypeError: cannot read properties of undefined')?.pattern).toBe('js-error');
    expect(detectError('Traceback (most recent call last):\n  File "a.py", line 3')?.pattern).toBe('python-traceback');
    expect(detectError("thread 'main' panicked at src/main.rs:5:9")?.pattern).toBe('rust-panic');
    expect(detectError('Segmentation fault (core dumped)')?.pattern).toBe('segfault');
    expect(detectError('  at foo (/app/index.js:10:5)')?.pattern).toBe('node-stack');
  });

  it('returns null for clean text', () => {
    expect(detectError('the build finished successfully in 3s')).toBeNull();
    expect(detectError('')).toBeNull();
  });
});

function fakeLocalization(file: string): FaultLocalizationResult {
  return {
    faults: [
      {
        id: 'f1',
        type: 'logic' as never,
        severity: 'high' as never,
        message: 'suspected fault',
        location: { file, startLine: 12, endLine: 12 },
        suspiciousness: 0.8,
        metadata: {},
      },
    ],
    suspiciousStatements: [],
    analysisTime: 1,
  };
}

function obs(text: string | undefined, changed = true): Observation {
  return { ts: 1, framePath: '/tmp/f.png', changed, ...(text !== undefined ? { text } : {}) };
}

describe('ScreenErrorWatcher.processObservation', () => {
  it('localizes a detected error and emits a suggestion', async () => {
    const suggestions: string[] = [];
    let localized = 0;
    const w = new ScreenErrorWatcher({
      localize: async () => {
        localized++;
        return fakeLocalization('src/buggy.ts');
      },
      onSuggestion: (s) => suggestions.push(s.error.pattern),
    });
    const r = await w.processObservation(obs('TypeError: boom\n  at run (/app/x.js:3:1)'));
    expect(r).not.toBeNull();
    expect(localized).toBe(1);
    expect(r!.localization.faults[0]!.location.file).toBe('src/buggy.ts');
    expect(suggestions).toEqual(['js-error']);
  });

  it('ignores idle frames and clean frames', async () => {
    const w = new ScreenErrorWatcher({ localize: async () => fakeLocalization('x') });
    expect(await w.processObservation(obs('TypeError: x', false))).toBeNull(); // idle
    expect(await w.processObservation(obs('all good'))).toBeNull(); // no error
    expect(await w.processObservation(obs(undefined))).toBeNull(); // no OCR text
  });

  it('does not re-localize the same error within the cooldown', async () => {
    let localized = 0;
    let clock = 0;
    const w = new ScreenErrorWatcher({
      cooldownMs: 60_000,
      now: () => clock,
      localize: async () => {
        localized++;
        return fakeLocalization('x');
      },
    });
    const err = obs('ReferenceError: foo is not defined');
    await w.processObservation(err); // localize #1
    clock += 10_000; // within cooldown
    await w.processObservation(err); // skipped
    expect(localized).toBe(1);
    clock += 60_000; // past cooldown
    await w.processObservation(err); // localize #2
    expect(localized).toBe(2);
  });
});
