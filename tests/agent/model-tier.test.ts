import { describe, it, expect } from 'vitest';
import {
  resolveModelTierConfig,
  chooseAutonomousModel,
  type ModelTierConfig,
} from '../../src/agent/model-tier';

describe('resolveModelTierConfig', () => {
  it('defaults to a local Ollama tier with no escalation', () => {
    const cfg = resolveModelTierConfig({});
    expect(cfg.localModel).toBe('llama3.2');
    expect(cfg.localBaseUrl).toBe('http://localhost:11434/v1');
    expect(cfg.escalationModel).toBeUndefined();
  });

  it('reads explicit local + escalation models from the env', () => {
    const cfg = resolveModelTierConfig({
      CODEBUDDY_LOCAL_MODEL: 'qwen2.5:7b-instruct',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434/v1/',
      CODEBUDDY_ESCALATION_MODEL: 'claude-opus-4-8',
    });
    expect(cfg.localModel).toBe('qwen2.5:7b-instruct');
    expect(cfg.localBaseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(cfg.escalationModel).toBe('claude-opus-4-8');
  });

  it('derives the local base URL from OLLAMA_HOST and falls back to GROK_MODEL for escalation', () => {
    const cfg = resolveModelTierConfig({ OLLAMA_HOST: 'http://box:11434', GROK_MODEL: 'grok-3' });
    expect(cfg.localBaseUrl).toBe('http://box:11434/v1');
    expect(cfg.escalationModel).toBe('grok-3');
  });
});

describe('chooseAutonomousModel', () => {
  const cfg: ModelTierConfig = {
    localModel: 'qwen2.5:7b-instruct',
    localBaseUrl: 'http://localhost:11434/v1',
    escalationModel: 'claude-opus-4-8',
  };

  it('runs routine work on the local ($0) model by default', () => {
    const choice = chooseAutonomousModel(cfg);
    expect(choice.tier).toBe('local');
    expect(choice.paid).toBe(false);
    expect(choice.model).toBe('qwen2.5:7b-instruct');
    expect(choice.baseUrl).toBe('http://localhost:11434/v1');
  });

  it('escalates to the paid model on explicit request', () => {
    const choice = chooseAutonomousModel(cfg, { escalate: true });
    expect(choice.tier).toBe('escalated');
    expect(choice.paid).toBe(true);
    expect(choice.model).toBe('claude-opus-4-8');
    expect(choice.reason).toMatch(/requested escalation/);
  });

  it('escalates after enough local failures', () => {
    expect(chooseAutonomousModel(cfg, { failures: 1 }).tier).toBe('local');
    expect(chooseAutonomousModel(cfg, { failures: 2 }).tier).toBe('escalated');
  });

  it('escalates on priority only when the policy opts in', () => {
    expect(chooseAutonomousModel(cfg, { priority: 'critical' }).tier).toBe('local');
    expect(chooseAutonomousModel(cfg, { priority: 'critical' }, { escalateAtPriority: 'high' }).tier).toBe('escalated');
    expect(chooseAutonomousModel(cfg, { priority: 'medium' }, { escalateAtPriority: 'high' }).tier).toBe('local');
  });

  it('stays local (for free) when escalation is warranted but no escalation model is configured', () => {
    const localOnly: ModelTierConfig = { localModel: 'llama3.2', localBaseUrl: 'http://localhost:11434/v1' };
    const choice = chooseAutonomousModel(localOnly, { escalate: true });
    expect(choice.tier).toBe('local');
    expect(choice.paid).toBe(false);
    expect(choice.reason).toMatch(/no escalation model configured/);
  });
});
