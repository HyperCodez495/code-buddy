/**
 * matchModel (via getModelToolConfig) must treat a literal '.' in a version
 * pattern as a DOT, not regex "any char". Before escaping, `gpt-5.5` / `gpt-4.1`
 * over-matched families like `gpt-5x5` / `gpt-4o1` and handed them the wrong
 * context/output caps. `*` and `?` remain glob wildcards.
 */
import { describe, it, expect } from 'vitest';
import { getModelToolConfig, type ModelToolConfig } from '../../src/config/model-tools.js';

const SENTINEL = 424242; // a contextWindow no real config uses, to detect a match

function cfg(model: string): ModelToolConfig[] {
  return [{ model, contextWindow: SENTINEL, maxOutputTokens: 111 }];
}

describe('model glob matching escapes regex metacharacters', () => {
  it('a literal dot only matches a literal dot', () => {
    expect(getModelToolConfig('gpt-5.5', cfg('gpt-5.5')).contextWindow).toBe(SENTINEL); // exact
    // The dot is now literal → these do NOT match the custom pattern.
    expect(getModelToolConfig('gpt-5x5', cfg('gpt-5.5')).contextWindow).not.toBe(SENTINEL);
    expect(getModelToolConfig('gpt-455', cfg('gpt-4.5')).contextWindow).not.toBe(SENTINEL);
  });

  it('a version pattern no longer bleeds into an adjacent family', () => {
    // `gpt-4.1` used to match `gpt-4o1` (dot = any char); it must not now.
    expect(getModelToolConfig('gpt-4o1', cfg('gpt-4.1')).contextWindow).not.toBe(SENTINEL);
    expect(getModelToolConfig('gpt-4.1', cfg('gpt-4.1')).contextWindow).toBe(SENTINEL);
  });

  it('the * wildcard still matches a family prefix', () => {
    expect(getModelToolConfig('grok-3-fast', cfg('grok-3*')).contextWindow).toBe(SENTINEL);
    expect(getModelToolConfig('grok-3', cfg('grok-3*')).contextWindow).toBe(SENTINEL);
    expect(getModelToolConfig('grok-4', cfg('grok-3*')).contextWindow).not.toBe(SENTINEL);
  });

  it('the ? wildcard matches exactly one character', () => {
    expect(getModelToolConfig('o3', cfg('o?')).contextWindow).toBe(SENTINEL);
    expect(getModelToolConfig('o33', cfg('o?')).contextWindow).not.toBe(SENTINEL); // two chars
  });
});
