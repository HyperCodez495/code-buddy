import { describe, it, expect } from 'vitest';
import {
  resolveModelTierConfig,
  chooseAutonomousModel,
  parseNetworkModels,
  type ModelTierConfig,
} from '../../src/agent/model-tier';

describe('resolveModelTierConfig', () => {
  it('defaults to a local Ollama tier with no network/escalation', () => {
    const cfg = resolveModelTierConfig({});
    expect(cfg.localModel).toBe('llama3.2');
    expect(cfg.localBaseUrl).toBe('http://localhost:11434/v1');
    expect(cfg.networkModels).toBeUndefined();
    expect(cfg.escalationModel).toBeUndefined();
  });

  it('reads local, network (Tailscale), and escalation tiers from the env', () => {
    const cfg = resolveModelTierConfig({
      CODEBUDDY_LOCAL_MODEL: 'qwen2.5:7b-instruct',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434/v1/',
      CODEBUDDY_NETWORK_MODELS: 'qwen3.6:27b@http://darkstar:11434/v1, devstral@http://g7:11434/v1/',
      CODEBUDDY_ESCALATION_MODEL: 'claude-opus-4-8',
    });
    expect(cfg.localModel).toBe('qwen2.5:7b-instruct');
    expect(cfg.localBaseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(cfg.networkModels).toEqual([
      { model: 'qwen3.6:27b', baseUrl: 'http://darkstar:11434/v1' },
      { model: 'devstral', baseUrl: 'http://g7:11434/v1' },
    ]);
    expect(cfg.escalationModel).toBe('claude-opus-4-8');
  });

  it('derives the local base URL from OLLAMA_HOST and falls back to GROK_MODEL', () => {
    const cfg = resolveModelTierConfig({ OLLAMA_HOST: 'http://box:11434', GROK_MODEL: 'grok-3' });
    expect(cfg.localBaseUrl).toBe('http://box:11434/v1');
    expect(cfg.escalationModel).toBe('grok-3');
  });
});

describe('parseNetworkModels', () => {
  it('parses model@url csv and skips malformed entries', () => {
    expect(parseNetworkModels('a@http://h1/v1, bad-entry, b@http://h2/v1')).toEqual([
      { model: 'a', baseUrl: 'http://h1/v1' },
      { model: 'b', baseUrl: 'http://h2/v1' },
    ]);
    expect(parseNetworkModels('')).toEqual([]);
    expect(parseNetworkModels(undefined)).toEqual([]);
  });
});

describe('chooseAutonomousModel (free-first ladder)', () => {
  const cfg: ModelTierConfig = {
    localModel: 'qwen2.5:7b-instruct',
    localBaseUrl: 'http://localhost:11434/v1',
    networkModels: [{ model: 'qwen3.6:27b', baseUrl: 'http://darkstar:11434/v1' }],
    escalationModel: 'claude-opus-4-8',
  };

  it('runs basic work on the fastest local ($0) model by default', () => {
    const c = chooseAutonomousModel(cfg);
    expect(c.tier).toBe('local');
    expect(c.paid).toBe(false);
    expect(c.model).toBe('qwen2.5:7b-instruct');
  });

  it('climbs to the free network tier when more power is needed (1 rung)', () => {
    const c = chooseAutonomousModel(cfg, { failures: 2 });
    expect(c.tier).toBe('network');
    expect(c.paid).toBe(false);
    expect(c.model).toBe('qwen3.6:27b');
    expect(c.baseUrl).toBe('http://darkstar:11434/v1');
  });

  it('escalates to the paid model only at the top rung', () => {
    expect(chooseAutonomousModel(cfg, { escalate: true }).tier).toBe('escalated');
    expect(chooseAutonomousModel(cfg, { failures: 4 }).tier).toBe('escalated');
    expect(chooseAutonomousModel(cfg, { escalate: true }).paid).toBe(true);
  });

  it('maps priority to rungs only when the policy opts in', () => {
    expect(chooseAutonomousModel(cfg, { priority: 'critical' }).tier).toBe('local'); // no policy → local
    expect(chooseAutonomousModel(cfg, { priority: 'high' }, { escalateAtPriority: 'high' }).tier).toBe('network');
    expect(chooseAutonomousModel(cfg, { priority: 'critical' }, { escalateAtPriority: 'high' }).tier).toBe('escalated');
  });

  it('stays free: falls back down the ladder when a higher tier is not configured', () => {
    const noNetwork: ModelTierConfig = { localModel: 'm', localBaseUrl: 'u', escalationModel: 'paid' };
    expect(chooseAutonomousModel(noNetwork, { failures: 2 }).tier).toBe('local'); // rung 1 but no network → local

    const noPaid: ModelTierConfig = { localModel: 'm', localBaseUrl: 'u', networkModels: [{ model: 'n', baseUrl: 'nu' }] };
    expect(chooseAutonomousModel(noPaid, { escalate: true }).tier).toBe('network'); // rung 2 but no paid → free network

    const localOnly: ModelTierConfig = { localModel: 'm', localBaseUrl: 'u' };
    const c = chooseAutonomousModel(localOnly, { escalate: true });
    expect(c.tier).toBe('local');
    expect(c.paid).toBe(false);
  });
});
