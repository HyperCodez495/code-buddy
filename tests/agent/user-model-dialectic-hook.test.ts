import { describe, it, expect, beforeEach, vi } from 'vitest';

const { runUserDialecticInferenceMock, isFeatureEnabledMock } = vi.hoisted(() => ({
  runUserDialecticInferenceMock: vi.fn<any[], Promise<any>>(),
  isFeatureEnabledMock: vi.fn<[string], boolean>(),
}));

vi.mock('../../src/memory/user-model.js', () => ({
  runUserDialecticInference: runUserDialecticInferenceMock,
}));

vi.mock('../../src/config/feature-flags.js', () => ({
  isFeatureEnabled: isFeatureEnabledMock,
}));

import { CodeBuddyAgent } from '../../src/agent/codebuddy-agent.js';

describe('User Model Dialectic Hook on Session End (GAP-11)', () => {
  beforeEach(() => {
    runUserDialecticInferenceMock.mockReset();
    isFeatureEnabledMock.mockReset();
  });

  it('does not trigger runUserDialecticInference when USER_MODEL_DIALECTIC_ON_SESSION_END is disabled', async () => {
    isFeatureEnabledMock.mockImplementation((flag) => {
      if (flag === 'USER_MODEL_DIALECTIC_ON_SESSION_END') return false;
      return true;
    });

    const agent = new CodeBuddyAgent('test-api-key');
    // Simulate some messages in history
    agent.historyManager.setChatHistory([
      { type: 'user', content: 'hello', timestamp: new Date() },
      { type: 'assistant', content: 'hi', timestamp: new Date() }
    ]);

    agent.dispose();

    // Small delay to allow any floating promise to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(runUserDialecticInferenceMock).not.toHaveBeenCalled();
  });

  it('triggers runUserDialecticInference when USER_MODEL_DIALECTIC_ON_SESSION_END is enabled and history has messages', async () => {
    isFeatureEnabledMock.mockImplementation((flag) => {
      if (flag === 'USER_MODEL_DIALECTIC_ON_SESSION_END') return true;
      return true;
    });
    runUserDialecticInferenceMock.mockResolvedValue([{ id: '1', kind: 'preference', content: 'test', status: 'pending' }]);

    const agent = new CodeBuddyAgent('test-api-key');
    agent.historyManager.setChatHistory([
      { type: 'user', content: 'hello', timestamp: new Date() },
      { type: 'assistant', content: 'hi', timestamp: new Date() }
    ]);

    agent.dispose();

    // Small delay to allow any floating promise to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(runUserDialecticInferenceMock).toHaveBeenCalled();
  });

  it('does not trigger runUserDialecticInference if there are no messages in history', async () => {
    isFeatureEnabledMock.mockImplementation((flag) => {
      if (flag === 'USER_MODEL_DIALECTIC_ON_SESSION_END') return true;
      return true;
    });

    const agent = new CodeBuddyAgent('test-api-key');
    agent.historyManager.setChatHistory([]);

    agent.dispose();

    // Small delay to allow any floating promise to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(runUserDialecticInferenceMock).not.toHaveBeenCalled();
  });
});
