import { describe, expect, it } from 'vitest';
import {
  AGENT_RUN_SCHEMA_VERSION,
  buildAgentRun,
  buildAgentRunId,
  buildAgentRunMetadata,
  isAgentRun,
} from '../../src/agent/agent-run-contract.js';

describe('agent run contract', () => {
  it('builds a canonical run envelope with lineage, policy and proof context', () => {
    const createdAt = '2026-05-18T15:00:00.000Z';
    const run = buildAgentRun({
      source: 'cowork',
      status: 'queued',
      createdAt,
      prompt: '  Run the Hermes Cowork checklist.  ',
      title: ' Scheduled Fleet dispatch ',
      profile: ' safe ',
      privacyTag: ' public ',
      cwd: ' D:/CascadeProjects/grok-cli-weekend ',
      lineage: {
        deliveryChannel: ' cowork-schedule ',
        hermesPlanId: ' hermes-integration-plan ',
        planId: ' plan-1 ',
        parentRunId: ' parent-run-1 ',
      },
      memory: {
        included: true,
        count: 2.9,
        sourceIds: [' memory-a ', '', 'memory-b'],
      },
      fleet: {
        peerCount: 2.7,
        targetPeerIds: [' peer-a ', '', 'peer-b'],
        targetPeerLabels: [' local-alpha ', 'local-beta'],
      },
      proof: {
        stepCount: 4.8,
        requiredCount: 3,
        assertionCount: 1,
        tools: [' web_fetch ', '', 'browser'],
        steps: [{ id: 'static-read', tool: 'web_fetch' }],
      },
      artifacts: [
        { kind: 'script', path: ' artifacts/research-script.ts ', title: ' Research script ' },
        { kind: 'trace', path: ' ' },
      ],
      toolPolicy: {
        toolsetId: ' fleet.hermes.safe ',
        profile: ' safe ',
      },
      metadata: {
        scheduleMode: 'once',
        empty: ' ',
      },
    });

    expect(run).toMatchObject({
      schemaVersion: AGENT_RUN_SCHEMA_VERSION,
      id: buildAgentRunId('cowork', [
        'Run the Hermes Cowork checklist.',
        createdAt,
        'Scheduled Fleet dispatch',
        'safe',
        'parent-run-1',
        'plan-1',
      ]),
      source: 'cowork',
      status: 'queued',
      createdAt,
      prompt: 'Run the Hermes Cowork checklist.',
      title: 'Scheduled Fleet dispatch',
      profile: 'safe',
      privacyTag: 'public',
      cwd: 'D:/CascadeProjects/grok-cli-weekend',
      lineage: {
        deliveryChannel: 'cowork-schedule',
        hermesPlanId: 'hermes-integration-plan',
        planId: 'plan-1',
        parentRunId: 'parent-run-1',
      },
      memory: {
        included: true,
        count: 2,
        sourceIds: ['memory-a', 'memory-b'],
      },
      fleet: {
        peerCount: 2,
        targetPeerIds: ['peer-a', 'peer-b'],
        targetPeerLabels: ['local-alpha', 'local-beta'],
      },
      proof: {
        stepCount: 4,
        requiredCount: 3,
        assertionCount: 1,
        tools: ['web_fetch', 'browser'],
        steps: [{ id: 'static-read', tool: 'web_fetch' }],
      },
      artifacts: [
        {
          kind: 'script',
          path: 'artifacts/research-script.ts',
          title: 'Research script',
        },
      ],
      toolPolicy: {
        toolsetId: 'fleet.hermes.safe',
        profile: 'safe',
      },
      metadata: {
        scheduleMode: 'once',
      },
    });
    expect(isAgentRun(run)).toBe(true);
    expect(buildAgentRunMetadata(run)).toEqual({
      agentRun: run,
      agentRunId: run.id,
      agentRunSchemaVersion: AGENT_RUN_SCHEMA_VERSION,
    });
  });

  it('keeps the contract compact when optional context is empty', () => {
    const run = buildAgentRun({
      source: 'test',
      createdAt: Date.UTC(2026, 4, 18, 8, 0),
      prompt: 'minimal run',
      memory: {
        included: false,
        count: -3,
        sourceIds: [' '],
      },
      fleet: {
        targetPeerIds: [],
      },
      proof: {
        tools: [' '],
      },
    });

    expect(run.createdAt).toBe('2026-05-18T08:00:00.000Z');
    expect(run.memory).toEqual({ included: false, count: 0 });
    expect(run).not.toHaveProperty('fleet');
    expect(run).not.toHaveProperty('proof');
    expect(isAgentRun({ ...run, prompt: 123 })).toBe(false);
  });
});
