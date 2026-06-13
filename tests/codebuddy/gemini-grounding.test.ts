/**
 * Tests for the Gemini Google Search grounding flag added in
 * `GeminiNativeProvider`:
 *   - `formatGroundingFooter` — static formatter for citation metadata
 *   - body shape: `{ googleSearch: {} }` injected into `tools` only when
 *     the flag is active (default off, default on, per-call override,
 *     JSON-mode incompatibility).
 *
 * No live network. We exercise the static formatter directly and reach
 * into the private `buildGeminiBody` via a type-cast (same pattern as
 * `client-gemini-vision.test.ts`).
 */

import { GeminiNativeProvider } from '../../src/codebuddy/providers/provider-gemini-native.js';
import type { CodeBuddyMessage, CodeBuddyTool, ChatOptions } from '../../src/codebuddy/client.js';

const callBuild = (
  p: GeminiNativeProvider,
  messages: CodeBuddyMessage[],
  tools?: CodeBuddyTool[],
  opts?: ChatOptions,
): Record<string, unknown> =>
  (p as unknown as {
    buildGeminiBody: (
      m: CodeBuddyMessage[],
      t?: CodeBuddyTool[],
      o?: ChatOptions,
    ) => Record<string, unknown>;
  }).buildGeminiBody(messages, tools, opts);

const aFewMessages: CodeBuddyMessage[] = [
  { role: 'user', content: 'What is the weather in Paris today?' },
];

const aDummyTool: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Look up the current weather',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
};

function makeProvider(defaultGoogleSearch?: boolean): GeminiNativeProvider {
  return new GeminiNativeProvider({
    apiKey: 'test-key',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash',
    defaultMaxTokens: 8192,
    geminiRequestTimeoutMs: 60000,
    defaultGoogleSearch,
  });
}

describe('GeminiNativeProvider.formatGroundingFooter', () => {
  it('returns empty string for missing or non-object metadata', () => {
    expect(GeminiNativeProvider.formatGroundingFooter(undefined)).toBe('');
    expect(GeminiNativeProvider.formatGroundingFooter(null)).toBe('');
    expect(GeminiNativeProvider.formatGroundingFooter('not-an-object')).toBe('');
  });

  it('returns empty string when groundingChunks is empty or missing', () => {
    expect(GeminiNativeProvider.formatGroundingFooter({})).toBe('');
    expect(GeminiNativeProvider.formatGroundingFooter({ groundingChunks: [] })).toBe('');
  });

  it('formats a single web citation', () => {
    const out = GeminiNativeProvider.formatGroundingFooter({
      groundingChunks: [
        { web: { uri: 'https://example.com/article', title: 'Example Article' } },
      ],
    });
    expect(out).toContain('**Sources:**');
    expect(out).toContain('[Example Article](https://example.com/article)');
  });

  it('falls back to URI when title is missing', () => {
    const out = GeminiNativeProvider.formatGroundingFooter({
      groundingChunks: [{ web: { uri: 'https://example.com/no-title' } }],
    });
    expect(out).toContain('[https://example.com/no-title](https://example.com/no-title)');
  });

  it('deduplicates URIs cited more than once', () => {
    const out = GeminiNativeProvider.formatGroundingFooter({
      groundingChunks: [
        { web: { uri: 'https://a.example/page', title: 'A' } },
        { web: { uri: 'https://a.example/page', title: 'A' } },
        { web: { uri: 'https://b.example/page', title: 'B' } },
      ],
    });
    // Format is `[Title](URI)`, so each unique URI shows up exactly once.
    const aMatches = out.match(/https:\/\/a\.example\/page/g) ?? [];
    expect(aMatches.length).toBe(1);
    expect(out).toContain('https://b.example/page');
    // 2 unique URIs → exactly 2 list bullets
    const bullets = out.match(/^- \[/gm) ?? [];
    expect(bullets.length).toBe(2);
  });

  it('includes search queries when present', () => {
    const out = GeminiNativeProvider.formatGroundingFooter({
      groundingChunks: [{ web: { uri: 'https://x.example', title: 'X' } }],
      webSearchQueries: ['paris weather today', 'météo paris'],
    });
    expect(out).toContain('paris weather today');
    expect(out).toContain('météo paris');
  });

  it('skips chunks that have no web URI', () => {
    const out = GeminiNativeProvider.formatGroundingFooter({
      groundingChunks: [
        { web: { uri: '', title: 'broken' } },
        { web: { uri: 'https://ok.example', title: 'ok' } },
      ],
    });
    expect(out).toContain('https://ok.example');
    expect(out).not.toContain('broken');
  });
});

describe('GeminiNativeProvider buildGeminiBody — googleSearch flag', () => {
  it('does not inject googleSearch when flag is off (default)', () => {
    const provider = makeProvider(false);
    const body = callBuild(provider, aFewMessages);
    expect(body.tools).toBeUndefined();
  });

  it('does not inject googleSearch when no flag and no tools', () => {
    const provider = makeProvider(); // undefined default
    const body = callBuild(provider, aFewMessages);
    expect(body.tools).toBeUndefined();
  });

  it('injects googleSearch when default is on, no other tools', () => {
    const provider = makeProvider(true);
    const body = callBuild(provider, aFewMessages);
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools).toEqual([{ googleSearch: {} }]);
    // No local tools → no toolConfig
    expect(body.toolConfig).toBeUndefined();
  });

  it('combines googleSearch with functionDeclarations when both active', () => {
    const provider = makeProvider(true);
    const body = callBuild(provider, aFewMessages, [aDummyTool]);
    const tools = body.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(2);
    expect(tools[0]).toEqual({ googleSearch: {} });
    expect(tools[1]).toHaveProperty('functionDeclarations');
    const fd = (tools[1].functionDeclarations as Array<{ name: string }>);
    expect(fd[0].name).toBe('get_weather');
    // Local tools → toolConfig present
    expect(body.toolConfig).toEqual({ functionCallingConfig: { mode: 'AUTO' } });
  });

  it('per-call googleSearch=true overrides a falsy default', () => {
    const provider = makeProvider(false);
    const body = callBuild(provider, aFewMessages, undefined, { googleSearch: true });
    expect(body.tools).toEqual([{ googleSearch: {} }]);
  });

  it('per-call googleSearch=false overrides a true default', () => {
    const provider = makeProvider(true);
    const body = callBuild(provider, aFewMessages, undefined, { googleSearch: false });
    expect(body.tools).toBeUndefined();
  });

  it('strips responseMimeType when grounding is on (Gemini API rejects the combo)', () => {
    const provider = makeProvider(true);
    const body = callBuild(provider, aFewMessages, undefined, { responseFormat: 'json' });
    const gen = body.generationConfig as Record<string, unknown>;
    expect(gen.responseMimeType).toBeUndefined();
    expect(body.tools).toEqual([{ googleSearch: {} }]);
  });

  it('keeps responseMimeType when grounding is off (JSON mode still works)', () => {
    const provider = makeProvider(false);
    const body = callBuild(provider, aFewMessages, undefined, { responseFormat: 'json' });
    const gen = body.generationConfig as Record<string, unknown>;
    expect(gen.responseMimeType).toBe('application/json');
  });

  it('uses per-call maxTokens for generationConfig.maxOutputTokens', () => {
    const provider = makeProvider(false);
    const body = callBuild(provider, aFewMessages, undefined, { maxTokens: 1234 });
    const gen = body.generationConfig as Record<string, unknown>;
    expect(gen.maxOutputTokens).toBe(1234);
  });

  it('setDefaultGoogleSearch toggles the default mid-flight', () => {
    const provider = makeProvider(false);
    expect(callBuild(provider, aFewMessages).tools).toBeUndefined();
    provider.setDefaultGoogleSearch(true);
    expect(callBuild(provider, aFewMessages).tools).toEqual([{ googleSearch: {} }]);
  });
});
