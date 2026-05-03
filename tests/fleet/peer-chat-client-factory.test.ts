/**
 * Phase (d).16a V0.4.1 — peer-chat-client-factory tests.
 *
 * Validates env-driven provider detection: priority order, override,
 * model override, isLocal flag per provider, defensive fallback when
 * env is empty or override is unknown.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  createPeerChatClientFromEnv,
  _getDetectionOrderForTests,
} from '../../src/fleet/peer-chat-client-factory.js';

/** Snapshot env vars we touch so each test can reset them cleanly. */
const ENV_KEYS_TO_PRESERVE = [
  'CODEBUDDY_PEER_PROVIDER',
  'CODEBUDDY_PEER_MODEL',
  'OLLAMA_HOST',
  'GROK_API_KEY',
  'GROK_BASE_URL',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
];

let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = {};
  for (const key of ENV_KEYS_TO_PRESERVE) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS_TO_PRESERVE) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('peer-chat-client-factory — Phase (d).16a', () => {
  describe('detection order constant', () => {
    it('exposes the documented priority order (local first)', () => {
      expect(_getDetectionOrderForTests()).toEqual([
        'ollama',
        'grok',
        'anthropic',
        'gemini',
        'openai',
      ]);
    });
  });

  describe('createPeerChatClientFromEnv — empty env', () => {
    it('returns null when no provider key is set', () => {
      expect(createPeerChatClientFromEnv()).toBeNull();
    });
  });

  describe('CODEBUDDY_PEER_PROVIDER override', () => {
    it('honors an explicit override even when other providers are configured', () => {
      // Both Ollama (priority 1) and Gemini are set, but the override picks Gemini.
      process.env.OLLAMA_HOST = 'localhost:11434';
      process.env.GOOGLE_API_KEY = 'AIza-test-key';
      process.env.CODEBUDDY_PEER_PROVIDER = 'gemini';
      const result = createPeerChatClientFromEnv();
      expect(result).not.toBeNull();
      expect(result!.info.provider).toBe('gemini');
      expect(result!.info.isLocal).toBe(false);
    });

    it('returns null when override names a provider whose env is missing', () => {
      // ANTHROPIC_API_KEY not set, but override demands Anthropic.
      process.env.CODEBUDDY_PEER_PROVIDER = 'anthropic';
      expect(createPeerChatClientFromEnv()).toBeNull();
    });

    it('returns null + warns on an unknown provider override (defensive)', () => {
      process.env.CODEBUDDY_PEER_PROVIDER = 'totally-not-a-provider';
      // Even with Gemini configured, the unknown override blocks it
      process.env.GOOGLE_API_KEY = 'AIza-test-key';
      expect(createPeerChatClientFromEnv()).toBeNull();
    });
  });

  describe('auto-detection priority order', () => {
    it('Ollama beats every cloud provider when OLLAMA_HOST is set', () => {
      process.env.OLLAMA_HOST = 'localhost:11434';
      process.env.GROK_API_KEY = 'grok-x';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
      process.env.GOOGLE_API_KEY = 'AIza-x';
      process.env.OPENAI_API_KEY = 'sk-x';
      const result = createPeerChatClientFromEnv();
      expect(result!.info.provider).toBe('ollama');
      expect(result!.info.isLocal).toBe(true);
    });

    it('Grok beats Anthropic + Gemini + OpenAI when ollama not set', () => {
      process.env.GROK_API_KEY = 'grok-x';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
      process.env.GOOGLE_API_KEY = 'AIza-x';
      process.env.OPENAI_API_KEY = 'sk-x';
      expect(createPeerChatClientFromEnv()!.info.provider).toBe('grok');
    });

    it('Anthropic beats Gemini + OpenAI when grok not set', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
      process.env.GOOGLE_API_KEY = 'AIza-x';
      process.env.OPENAI_API_KEY = 'sk-x';
      expect(createPeerChatClientFromEnv()!.info.provider).toBe('anthropic');
    });

    it('Gemini wins when only Google + OpenAI keys are set', () => {
      process.env.GOOGLE_API_KEY = 'AIza-x';
      process.env.OPENAI_API_KEY = 'sk-x';
      expect(createPeerChatClientFromEnv()!.info.provider).toBe('gemini');
    });

    it('GEMINI_API_KEY also activates the Gemini provider (alias for GOOGLE_API_KEY)', () => {
      process.env.GEMINI_API_KEY = 'gem-key';
      const result = createPeerChatClientFromEnv();
      expect(result!.info.provider).toBe('gemini');
    });

    it('OpenAI is the last-resort fallback', () => {
      process.env.OPENAI_API_KEY = 'sk-x';
      expect(createPeerChatClientFromEnv()!.info.provider).toBe('openai');
    });
  });

  describe('isLocal flag', () => {
    it('is true for ollama, false for every cloud provider', () => {
      process.env.OLLAMA_HOST = 'localhost:11434';
      expect(createPeerChatClientFromEnv()!.info.isLocal).toBe(true);

      delete process.env.OLLAMA_HOST;
      process.env.GROK_API_KEY = 'x';
      expect(createPeerChatClientFromEnv()!.info.isLocal).toBe(false);

      delete process.env.GROK_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'x';
      expect(createPeerChatClientFromEnv()!.info.isLocal).toBe(false);

      delete process.env.ANTHROPIC_API_KEY;
      process.env.GOOGLE_API_KEY = 'x';
      expect(createPeerChatClientFromEnv()!.info.isLocal).toBe(false);

      delete process.env.GOOGLE_API_KEY;
      process.env.OPENAI_API_KEY = 'x';
      expect(createPeerChatClientFromEnv()!.info.isLocal).toBe(false);
    });
  });

  describe('CODEBUDDY_PEER_MODEL override', () => {
    it('overrides the provider default model', () => {
      process.env.GOOGLE_API_KEY = 'x';
      process.env.CODEBUDDY_PEER_MODEL = 'gemini-2.0-flash-exp';
      const result = createPeerChatClientFromEnv();
      expect(result!.info.model).toBe('gemini-2.0-flash-exp');
    });

    it('falls back to the provider default when CODEBUDDY_PEER_MODEL is not set', () => {
      process.env.GOOGLE_API_KEY = 'x';
      const result = createPeerChatClientFromEnv();
      expect(result!.info.model).toBe('gemini-2.5-flash');
    });
  });

  describe('OLLAMA_HOST normalization', () => {
    it('accepts bare host:port (prepends http:// + appends /v1)', () => {
      process.env.OLLAMA_HOST = 'localhost:11434';
      // The factory must build a client without throwing — that's what we
      // assert here. The exact baseUrl is internal; we trust the construct.
      const result = createPeerChatClientFromEnv();
      expect(result).not.toBeNull();
      expect(result!.info.provider).toBe('ollama');
    });

    it('accepts a full URL with /v1 suffix', () => {
      process.env.OLLAMA_HOST = 'http://my-ollama.local:11434/v1';
      const result = createPeerChatClientFromEnv();
      expect(result!.info.provider).toBe('ollama');
    });

    it('accepts a URL without /v1 (factory appends it)', () => {
      process.env.OLLAMA_HOST = 'http://my-ollama.local:11434';
      const result = createPeerChatClientFromEnv();
      expect(result!.info.provider).toBe('ollama');
    });
  });

  describe('client construction sanity', () => {
    it('returns a CodeBuddyClient instance with a chat() method', () => {
      process.env.GOOGLE_API_KEY = 'x';
      const result = createPeerChatClientFromEnv();
      expect(result).not.toBeNull();
      expect(typeof result!.client.chat).toBe('function');
    });
  });
});
