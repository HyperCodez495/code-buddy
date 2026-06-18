import { describe, it, expect } from 'vitest';
import { orderFallbacks, type ActiveLlm } from '../../src/providers/active-llm-registry.js';

/**
 * Locks the failover ORDERING policy — the user-facing behavior of the
 * active-LLM registry. The full registry build is proven live (it joins live
 * logins); here we pin the deterministic ordering logic.
 */
function llm(partial: Partial<ActiveLlm>): ActiveLlm {
  return {
    provider: partial.provider ?? 'x',
    label: partial.provider ?? 'x',
    apiMode: 'openai-compatible',
    authMode: 'api-key',
    apiKey: 'k',
    baseURL: `https://${partial.provider ?? 'x'}.example/v1`,
    defaultModel: 'm',
    source: 'override',
    model: 'm',
    rawSpec: `active:${partial.provider ?? 'x'}`,
    fallbackSource: 'environment',
    isLocal: partial.isLocal ?? false,
    reachable: true,
    priority: partial.priority ?? 100,
    costInputUsdPerMtok: partial.costInputUsdPerMtok ?? 1,
    ...partial,
  } as ActiveLlm;
}

describe('active-llm-registry — failover ordering', () => {
  const chatgpt = llm({ provider: 'chatgpt', isLocal: false, priority: 10, costInputUsdPerMtok: 0 });
  const grok = llm({ provider: 'grok', isLocal: false, priority: 30, costInputUsdPerMtok: 0.5 });
  const ollama = llm({ provider: 'ollama', isLocal: true, priority: 20, costInputUsdPerMtok: 0 });

  it('resilience: capable/subscription first, local LAST', () => {
    const ordered = orderFallbacks([ollama, grok, chatgpt], 'resilience');
    expect(ordered.map((p) => p.provider)).toEqual(['chatgpt', 'grok', 'ollama']);
    expect(ordered[ordered.length - 1].isLocal).toBe(true);
  });

  it('free-first: cheapest first (ties keep priority order)', () => {
    const ordered = orderFallbacks([grok, chatgpt, ollama], 'free-first');
    // chatgpt($0,prio10) and ollama($0,prio20) before grok($0.5)
    expect(ordered.map((p) => p.provider)).toEqual(['chatgpt', 'ollama', 'grok']);
  });

  it('manual: explicit order wins, unknowns sink to the end', () => {
    const ordered = orderFallbacks([chatgpt, grok, ollama], 'manual', ['grok', 'ollama']);
    expect(ordered.map((p) => p.provider)).toEqual(['grok', 'ollama', 'chatgpt']);
  });
});
