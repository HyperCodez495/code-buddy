/**
 * getModelStrengths — the single source of truth for model strengths.
 *
 * Pins the precedence rule that replaced the three divergent regex mappers:
 * config booleans are AUTHORITATIVE when a glob matches (a name pattern never
 * grants vision/reasoning/tool-calling against the config); the full legacy
 * regex union only applies to unknown models.
 */
import { describe, expect, it } from 'vitest';
import { getModelStrengths } from '../../src/config/model-tools.js';
import { inferStrengths } from '../../src/fleet/model-capability-heuristics.js';

describe('getModelStrengths — booleans are authoritative for known models', () => {
  it('never grants tool-calling to models the config gates to chat-only', () => {
    // qwen2.5:7b emits tool calls as TEXT via Ollama (supportsToolCalls: false,
    // pinned by tests/config/model-tools-local-toolcalls.test.ts).
    expect(getModelStrengths('qwen2.5-coder:7b')).not.toContain('tool-calling');
    expect(getModelStrengths('llama3.2')).not.toContain('tool-calling');
    expect(getModelStrengths('gemma3:4b')).not.toContain('tool-calling');
  });

  it('never grants vision against the config (gpt-5-codex is text-only)', () => {
    expect(getModelStrengths('gpt-5-codex')).not.toContain('vision');
    expect(getModelStrengths('gpt-5.5')).toContain('vision'); // config says true
  });

  it('never grants reasoning against the config (grok-3 / deepseek)', () => {
    expect(getModelStrengths('grok-3-fast')).not.toContain('reasoning');
    expect(getModelStrengths('deepseek-coder:6.7b')).not.toContain('reasoning');
  });

  it('derives long-context from the config contextWindow', () => {
    expect(getModelStrengths('claude-opus-4-6')).toContain('long-context'); // 200k
    expect(getModelStrengths('qwen3:8b')).not.toContain('long-context'); // 32k
  });

  it('honours the explicit strengths field', () => {
    expect(getModelStrengths('devstral-small-2:24b-instruct')).toEqual(
      expect.arrayContaining(['code', 'french']),
    );
    expect(getModelStrengths('claude-opus-4-6')).toEqual(expect.arrayContaining(['code', 'thinking']));
    expect(getModelStrengths('mistral-large-latest')).toContain('french');
  });

  it('keeps the fast/cheap name heuristic for known models (non-boolean strengths)', () => {
    expect(getModelStrengths('claude-haiku-4-5')).toEqual(expect.arrayContaining(['fast', 'cheap']));
    expect(getModelStrengths('gpt-5-mini')).toContain('cheap');
    expect(getModelStrengths('qwen2.5-coder:7b')).toContain('code');
  });
});

describe('getModelStrengths — unknown models fall back to the full regex union', () => {
  it('keeps the legacy behavior for names the config does not know', () => {
    const fake = getModelStrengths('coder-a');
    expect(fake).toContain('code');
    expect(fake).toContain('tool-calling'); // permissive fallback config

    expect(getModelStrengths('codestral-latest')).toContain('code');
    expect(getModelStrengths('some-vision-model')).toContain('vision');
  });
});

describe('delegation parity', () => {
  it('inferStrengths and getModelStrengths agree on a sample matrix', () => {
    for (const model of [
      'gpt-5.5',
      'gpt-5-codex',
      'grok-3-fast',
      'claude-haiku-4-5',
      'qwen2.5-coder:7b',
      'qwen3:8b',
      'devstral-small-2:24b-instruct',
      'coder-a',
      'codestral-latest',
    ]) {
      expect(inferStrengths(model).sort()).toEqual(getModelStrengths(model).sort());
    }
  });
});
