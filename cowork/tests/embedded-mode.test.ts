/**
 * Unit tests for the CODEBUDDY_EMBEDDED policy helpers.
 *
 * The bootstrap in `cowork/src/main/index.ts` is too heavy to import
 * directly (it triggers Electron, DB init, MCP, etc.), so we test the
 * pure helpers extracted into `engine/embedded-mode.ts` and rely on
 * code review + an end-to-end check to verify the bootstrap calls them
 * correctly.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyEngineLoadError,
  isEmbeddedOptOut,
} from '../src/main/engine/embedded-mode';

describe('isEmbeddedOptOut', () => {
  it('returns false when the env var is unset (default-on)', () => {
    expect(isEmbeddedOptOut({})).toBe(false);
  });

  it("returns false for the historical opt-in value '1'", () => {
    expect(isEmbeddedOptOut({ CODEBUDDY_EMBEDDED: '1' })).toBe(false);
  });

  it("returns true ONLY for the explicit opt-out '0'", () => {
    expect(isEmbeddedOptOut({ CODEBUDDY_EMBEDDED: '0' })).toBe(true);
  });

  it("does not interpret 'false' / '' / 'no' as opt-out (avoid surprises)", () => {
    // We deliberately accept only the exact string '0' so users get
    // predictable behaviour and don't accidentally disable embedded mode
    // by setting an empty string or another falsy-looking value.
    expect(isEmbeddedOptOut({ CODEBUDDY_EMBEDDED: '' })).toBe(false);
    expect(isEmbeddedOptOut({ CODEBUDDY_EMBEDDED: 'false' })).toBe(false);
    expect(isEmbeddedOptOut({ CODEBUDDY_EMBEDDED: 'no' })).toBe(false);
    expect(isEmbeddedOptOut({ CODEBUDDY_EMBEDDED: 'off' })).toBe(false);
  });
});

describe('classifyEngineLoadError', () => {
  it("classifies 'MODULE_NOT_FOUND' as 'missing'", () => {
    const err = Object.assign(new Error('not found'), { code: 'MODULE_NOT_FOUND' });
    expect(classifyEngineLoadError(err)).toBe('missing');
  });

  it("classifies 'ERR_MODULE_NOT_FOUND' as 'missing' (ESM resolver)", () => {
    const err = Object.assign(new Error('not found'), { code: 'ERR_MODULE_NOT_FOUND' });
    expect(classifyEngineLoadError(err)).toBe('missing');
  });

  it("classifies any other error as 'broken' (worth surfacing)", () => {
    const syntaxErr = new SyntaxError('Unexpected token');
    expect(classifyEngineLoadError(syntaxErr)).toBe('broken');

    const genericErr = new Error('boom');
    expect(classifyEngineLoadError(genericErr)).toBe('broken');

    const codedErr = Object.assign(new Error('perm'), { code: 'EACCES' });
    expect(classifyEngineLoadError(codedErr)).toBe('broken');
  });

  it("classifies non-Error throws as 'broken' (defensive)", () => {
    expect(classifyEngineLoadError(null)).toBe('broken');
    expect(classifyEngineLoadError(undefined)).toBe('broken');
    expect(classifyEngineLoadError('string error')).toBe('broken');
    expect(classifyEngineLoadError(42)).toBe('broken');
  });
});
