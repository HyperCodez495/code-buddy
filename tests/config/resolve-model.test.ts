/**
 * Tests for src/config/resolve-model.ts
 *
 * Verifies:
 * - inferProvider maps model prefixes to the correct provider
 * - resolveModel follows the priority chain correctly
 * - Source tagging is accurate (explicit > saved > env > provider-default > fallback)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { inferProvider, resolveModel } from '../../src/config/resolve-model.js';
import { FALLBACK_MODEL, FALLBACK_PROVIDER, MODEL_DEFAULTS } from '../../src/config/model-defaults.js';

describe('resolve-model', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.GROK_MODEL;
    delete process.env.OPENAI_MODEL;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.GEMINI_MODEL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('inferProvider', () => {
    it('should return xai for grok- prefixed models', () => {
      expect(inferProvider('grok-code-fast-1')).toBe('xai');
      expect(inferProvider('grok-4-latest')).toBe('xai');
      expect(inferProvider('grok-3-fast')).toBe('xai');
    });

    it('should return openai for gpt- prefixed models', () => {
      expect(inferProvider('gpt-4o')).toBe('openai');
      expect(inferProvider('gpt-4.1')).toBe('openai');
    });

    it('should return openai for o-series models', () => {
      expect(inferProvider('o1-mini')).toBe('openai');
      expect(inferProvider('o3-mini')).toBe('openai');
      expect(inferProvider('o4-mini')).toBe('openai');
    });

    it('should return anthropic for claude- prefixed models', () => {
      expect(inferProvider('claude-sonnet-4-20250514')).toBe('anthropic');
      expect(inferProvider('claude-opus-4-6')).toBe('anthropic');
    });

    it('should return google for gemini- prefixed models', () => {
      expect(inferProvider('gemini-2.5-flash')).toBe('google');
      expect(inferProvider('gemini-2.0-flash')).toBe('google');
    });

    it('should return deepseek for deepseek models', () => {
      expect(inferProvider('deepseek-chat')).toBe('deepseek');
      expect(inferProvider('deepseek-coder')).toBe('deepseek');
    });

    it('should return mistral for mistral/devstral models', () => {
      expect(inferProvider('mistral-large')).toBe('mistral');
      expect(inferProvider('devstral-latest')).toBe('mistral');
      expect(inferProvider('mixtral-8x7b')).toBe('mistral');
    });

    it('should return ollama for llama/phi/gemma/qwen models', () => {
      expect(inferProvider('llama3.2')).toBe('ollama');
      expect(inferProvider('phi3')).toBe('ollama');
      expect(inferProvider('gemma2')).toBe('ollama');
      expect(inferProvider('qwen2.5')).toBe('ollama');
      expect(inferProvider('qwen3.5-ctx32k:latest')).toBe('ollama');
      expect(inferProvider('command-r')).toBe('ollama');
    });

    it('should return null for unknown model names', () => {
      expect(inferProvider('unknown-model')).toBeNull();
      expect(inferProvider('')).toBeNull();
    });
  });

  describe('resolveModel', () => {
    it('should return fallback when no input is provided', () => {
      const result = resolveModel();
      expect(result.model).toBe(FALLBACK_MODEL);
      expect(result.provider).toBe(FALLBACK_PROVIDER);
      expect(result.source).toBe('fallback');
    });

    it('should use explicitModel with highest priority', () => {
      const result = resolveModel({
        explicitModel: 'gpt-4o',
        savedModel: 'grok-4-latest',
        provider: 'xai',
      });
      expect(result.model).toBe('gpt-4o');
      expect(result.provider).toBe('openai');
      expect(result.source).toBe('explicit');
    });

    it('should use savedModel when no explicitModel', () => {
      const result = resolveModel({
        savedModel: 'claude-sonnet-4-20250514',
      });
      expect(result.model).toBe('claude-sonnet-4-20250514');
      expect(result.provider).toBe('anthropic');
      expect(result.source).toBe('saved');
    });

    it('should use provider default when no explicit or saved model', () => {
      const result = resolveModel({ provider: 'google' });
      expect(result.model).toBe(MODEL_DEFAULTS.google);
      expect(result.provider).toBe('google');
      expect(result.source).toBe('provider-default');
    });

    it('should use env var for provider when set', () => {
      process.env.GROK_MODEL = 'grok-4-latest';
      const result = resolveModel({ provider: 'xai' });
      expect(result.model).toBe('grok-4-latest');
      expect(result.provider).toBe('xai');
      expect(result.source).toBe('env');
    });

    it('should use provider hint for inference when explicit model has unknown prefix', () => {
      const result = resolveModel({
        explicitModel: 'my-custom-model',
        provider: 'openai',
      });
      expect(result.model).toBe('my-custom-model');
      expect(result.provider).toBe('openai');
      expect(result.source).toBe('explicit');
    });

    it('should fall back to FALLBACK_PROVIDER when explicit model has unknown prefix and no provider hint', () => {
      const result = resolveModel({
        explicitModel: 'my-custom-model',
      });
      expect(result.model).toBe('my-custom-model');
      expect(result.provider).toBe(FALLBACK_PROVIDER);
      expect(result.source).toBe('explicit');
    });

    it('should prefer savedModel provider inference over provider hint', () => {
      const result = resolveModel({
        savedModel: 'gemini-2.5-pro',
        provider: 'xai',
      });
      expect(result.model).toBe('gemini-2.5-pro');
      expect(result.provider).toBe('google');
      expect(result.source).toBe('saved');
    });
  });
});
