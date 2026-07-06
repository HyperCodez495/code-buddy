import { describe, it, expect } from 'vitest';
import { extractJsonObject, salvageJsonObjects } from '../../src/utils/json-salvage.js';

describe('extractJsonObject', () => {
  it('parses pure JSON', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('extracts an object wrapped in prose / markdown fences', () => {
    const text = 'Here is my verdict:\n```json\n{"winner":"b","why":"clearer"}\n```\nDone.';
    expect(extractJsonObject(text)).toEqual({ winner: 'b', why: 'clearer' });
  });

  it('is fail-closed on truncated or non-JSON text', () => {
    expect(extractJsonObject('{"a": 1, "b": [1, 2')).toBeNull();
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
  });
});

describe('salvageJsonObjects', () => {
  it('recovers complete objects from a truncated array', () => {
    const truncated = '[{"t":"a","p":1},{"t":"b","p":2},{"t":"c","p';
    expect(salvageJsonObjects(truncated)).toEqual([
      { t: 'a', p: 1 },
      { t: 'b', p: 2 },
    ]);
  });

  it('handles braces and escaped quotes inside strings', () => {
    const text = '[{"msg":"a {brace} and a \\" quote"},{"msg":"ok"},{"msg":"cut';
    expect(salvageJsonObjects(text)).toEqual([
      { msg: 'a {brace} and a " quote' },
      { msg: 'ok' },
    ]);
  });

  it('recovers nested objects as a single top-level item', () => {
    const text = 'prefix {"outer":{"inner":[1,2]}} suffix {"x":true';
    expect(salvageJsonObjects(text)).toEqual([{ outer: { inner: [1, 2] } }]);
  });

  it('skips individually malformed objects and keeps the rest', () => {
    const text = '{"ok":1} {broken: yes} {"ok":2}';
    expect(salvageJsonObjects(text)).toEqual([{ ok: 1 }, { ok: 2 }]);
  });

  it('returns [] on garbage or empty input', () => {
    expect(salvageJsonObjects('')).toEqual([]);
    expect(salvageJsonObjects('nothing structured')).toEqual([]);
  });
});
