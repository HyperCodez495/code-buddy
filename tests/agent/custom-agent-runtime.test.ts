import { describe, expect, it, beforeEach } from 'vitest';

import {
  getActiveCustomAgentRuntime,
  resetActiveCustomAgentRuntime,
  resolveActiveCustomAgentDispatchProfile,
  setActiveCustomAgentRuntime,
  shouldPropagateResolvedDispatchProfile,
} from '../../src/agent/custom/custom-agent-runtime.js';
import type { CustomAgentConfig } from '../../src/agent/custom/custom-agent-loader.js';

function agent(overrides: Partial<CustomAgentConfig> = {}): CustomAgentConfig {
  return {
    id: 'test',
    name: 'Test',
    description: '',
    systemPrompt: 'prompt',
    ...overrides,
  };
}

describe('custom agent runtime context', () => {
  beforeEach(() => {
    resetActiveCustomAgentRuntime();
  });

  it('stores active agent Fleet defaults without exposing mutable state', () => {
    setActiveCustomAgentRuntime(agent({
      fleetDispatchProfile: 'review',
      requireExplicitDispatchProfile: true,
    }));

    const active = getActiveCustomAgentRuntime();
    expect(active).toMatchObject({
      id: 'test',
      name: 'Test',
      fleetDispatchProfile: 'review',
      requireExplicitDispatchProfile: true,
    });
    if (active) active.name = 'Changed';
    expect(getActiveCustomAgentRuntime()?.name).toBe('Test');
  });

  it('prefers explicit profiles over active-agent defaults', () => {
    setActiveCustomAgentRuntime(agent({ fleetDispatchProfile: 'safe' }));

    const resolution = resolveActiveCustomAgentDispatchProfile('code');

    expect(resolution).toEqual({
      dispatchProfile: 'code',
      source: 'explicit',
    });
    expect(shouldPropagateResolvedDispatchProfile(resolution)).toBe(true);
  });

  it('uses active-agent defaults when no explicit profile is provided', () => {
    setActiveCustomAgentRuntime(agent({ fleetDispatchProfile: 'review' }));

    const resolution = resolveActiveCustomAgentDispatchProfile();

    expect(resolution).toEqual({
      dispatchProfile: 'review',
      source: 'agent-default',
      agentId: 'test',
    });
    expect(shouldPropagateResolvedDispatchProfile(resolution)).toBe(true);
  });

  it('keeps the legacy implicit balanced profile when no agent default exists', () => {
    const resolution = resolveActiveCustomAgentDispatchProfile();

    expect(resolution).toEqual({
      dispatchProfile: 'balanced',
      source: 'implicit-default',
    });
    expect(shouldPropagateResolvedDispatchProfile(resolution)).toBe(false);
  });
});
