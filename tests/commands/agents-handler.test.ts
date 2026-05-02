/**
 * /agents slash handler tests (MultiAgentSystem wake — top 4 audit OpenClaw).
 *
 * Covers: action validation, status output, env GROK_API_KEY guard,
 * fire-and-forget run lifecycle (single workflow at a time), strategy
 * setter validation, stop/disable propagation.
 *
 * Mocks the MultiAgentSystem module entirely — no real LLM calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Hoist mock targets so the vi.mock factory can reference them.
const mocks = vi.hoisted(() => {
  const runWorkflowMock = vi.fn();
  const stopMock = vi.fn();
  const disposeMock = vi.fn();

  const fakeSystem = {
    runWorkflow: runWorkflowMock,
    stop: stopMock,
    dispose: disposeMock,
  };

  const getMultiAgentSystemMock = vi.fn(() => fakeSystem);
  const resetMultiAgentSystemMock = vi.fn();

  return {
    runWorkflowMock,
    stopMock,
    disposeMock,
    fakeSystem,
    getMultiAgentSystemMock,
    resetMultiAgentSystemMock,
  };
});

vi.mock('../../src/agent/multi-agent/multi-agent-system.js', () => ({
  getMultiAgentSystem: mocks.getMultiAgentSystemMock,
  resetMultiAgentSystem: mocks.resetMultiAgentSystemMock,
}));

import { handleAgents, _resetAgentsHandlerForTests } from '../../src/commands/handlers/agents-handler.js';

describe('handleAgents (/agents)', () => {
  const originalApiKey = process.env.GROK_API_KEY;

  beforeEach(() => {
    process.env.GROK_API_KEY = 'test-key';
    _resetAgentsHandlerForTests();
    mocks.runWorkflowMock.mockReset();
    mocks.stopMock.mockReset();
    mocks.disposeMock.mockReset();
    mocks.getMultiAgentSystemMock.mockClear();
    mocks.resetMultiAgentSystemMock.mockClear();
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.GROK_API_KEY;
    else process.env.GROK_API_KEY = originalApiKey;
    _resetAgentsHandlerForTests();
  });

  it('rejects unknown action with help text', async () => {
    const r = await handleAgents(['lol']);
    expect(r.entry?.content).toContain('Unknown agents action');
    expect(r.entry?.content).toContain('Usage: /agents');
  });

  it('shows help when action is "help"', async () => {
    const r = await handleAgents(['help']);
    expect(r.entry?.content).toContain('Usage: /agents');
    expect(r.entry?.content).toContain('run <goal>');
    expect(r.entry?.content).toContain('plan <goal>');
    expect(r.entry?.content).toContain('strategy <name>');
  });

  it('defaults to status when no action provided', async () => {
    const r = await handleAgents([]);
    expect(r.entry?.content).toContain('Multi-Agent System Status');
    expect(r.entry?.content).toContain('Enabled:');
    expect(r.entry?.content).toContain('Default strategy:');
  });

  it('status shows hierarchical as default strategy initially', async () => {
    const r = await handleAgents(['status']);
    expect(r.entry?.content).toMatch(/Default strategy:\s+hierarchical/);
  });

  it('enable instantiates the singleton', async () => {
    const r = await handleAgents(['enable']);
    expect(r.entry?.content).toContain('Multi-agent system started');
    expect(mocks.getMultiAgentSystemMock).toHaveBeenCalledWith('test-key', undefined);

    const status = await handleAgents(['status']);
    expect(status.entry?.content).toMatch(/Enabled:\s+yes/);
  });

  it('enable is idempotent', async () => {
    await handleAgents(['enable']);
    const r = await handleAgents(['enable']);
    expect(r.entry?.content).toContain('already enabled');
  });

  it('enable without GROK_API_KEY returns clear error', async () => {
    delete process.env.GROK_API_KEY;
    const r = await handleAgents(['enable']);
    expect(r.entry?.content).toContain('GROK_API_KEY is not set');
  });

  it('disable resets the system when enabled', async () => {
    await handleAgents(['enable']);
    const r = await handleAgents(['disable']);
    expect(r.entry?.content).toContain('Multi-agent system stopped');
    expect(mocks.resetMultiAgentSystemMock).toHaveBeenCalled();

    const status = await handleAgents(['status']);
    expect(status.entry?.content).toMatch(/Enabled:\s+no/);
  });

  it('disable is a no-op when not enabled', async () => {
    const r = await handleAgents(['disable']);
    expect(r.entry?.content).toContain('not enabled');
  });

  it('strategy without arg returns usage', async () => {
    const r = await handleAgents(['strategy']);
    expect(r.entry?.content).toContain('Usage: /agents strategy <name>');
    expect(r.entry?.content).toContain('hierarchical');
  });

  it('strategy with invalid name returns clear error', async () => {
    const r = await handleAgents(['strategy', 'nonsense']);
    expect(r.entry?.content).toContain('Unknown strategy: nonsense');
  });

  it('strategy with valid name updates default', async () => {
    const r = await handleAgents(['strategy', 'parallel']);
    expect(r.entry?.content).toContain('Default strategy set to: parallel');

    const status = await handleAgents(['status']);
    expect(status.entry?.content).toMatch(/Default strategy:\s+parallel/);
  });

  it('run without goal returns usage', async () => {
    const r = await handleAgents(['run']);
    expect(r.entry?.content).toContain('Usage: /agents run <goal>');
  });

  it('run launches fire-and-forget workflow and returns immediately', async () => {
    // Promise that never resolves during this test — simulates long-running workflow
    mocks.runWorkflowMock.mockImplementation(() => new Promise(() => { /* never */ }));

    const r = await handleAgents(['run', 'Add', 'a', 'hello', 'endpoint']);
    expect(r.entry?.content).toContain('Workflow started for: Add a hello endpoint');
    expect(r.entry?.content).toContain('Monitor with: /agents status');
    expect(mocks.runWorkflowMock).toHaveBeenCalledTimes(1);
    expect(mocks.runWorkflowMock).toHaveBeenCalledWith('Add a hello endpoint', { strategy: 'hierarchical' });

    const status = await handleAgents(['status']);
    expect(status.entry?.content).toContain('ACTIVE WORKFLOW');
    expect(status.entry?.content).toContain('Add a hello endpoint');
  });

  it('second run while one is active is refused', async () => {
    mocks.runWorkflowMock.mockImplementation(() => new Promise(() => { /* never */ }));

    await handleAgents(['run', 'goal-1']);
    const r = await handleAgents(['run', 'goal-2']);
    expect(r.entry?.content).toContain('already in progress');
    expect(r.entry?.content).toContain('goal-1');
    expect(mocks.runWorkflowMock).toHaveBeenCalledTimes(1);
  });

  it('stop after run cancels active workflow', async () => {
    mocks.runWorkflowMock.mockImplementation(() => new Promise(() => { /* never */ }));

    await handleAgents(['run', 'goal-x']);
    const r = await handleAgents(['stop']);
    expect(r.entry?.content).toContain('Workflow stopped: goal-x');
    expect(mocks.stopMock).toHaveBeenCalled();

    const status = await handleAgents(['status']);
    expect(status.entry?.content).toContain('Active workflow:   (none)');
  });

  it('stop without active workflow is a no-op', async () => {
    const r = await handleAgents(['stop']);
    expect(r.entry?.content).toContain('No active workflow to stop');
  });

  it('plan without goal returns usage', async () => {
    const r = await handleAgents(['plan']);
    expect(r.entry?.content).toContain('Usage: /agents plan <goal>');
  });

  it('plan with goal calls runWorkflow dryRun and returns plan text', async () => {
    mocks.runWorkflowMock.mockResolvedValue({
      success: true,
      plan: {
        phases: [
          { name: 'Phase 1', tasks: [{ description: 'Read existing code' }, { description: 'Write spec' }] },
          { name: 'Phase 2', tasks: [{ description: 'Implement endpoint' }] },
        ],
      },
      results: new Map(),
      artifacts: [],
      timeline: [],
      totalDuration: 1234,
      summary: 'Plan generated',
      errors: [],
    });

    const r = await handleAgents(['plan', 'Add', 'endpoint']);
    expect(mocks.runWorkflowMock).toHaveBeenCalledWith('Add endpoint', expect.objectContaining({ dryRun: true }));
    expect(r.entry?.content).toContain('Plan for: Add endpoint');
    expect(r.entry?.content).toContain('Phase 1: Phase 1');
    expect(r.entry?.content).toContain('Read existing code');
    expect(r.entry?.content).toContain('Phase 2');
  });

  it('action is case-insensitive', async () => {
    const r = await handleAgents(['ENABLE']);
    expect(r.entry?.content).toContain('Multi-agent system started');
  });
});
