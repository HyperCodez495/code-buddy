/**
 * Integration test — boots a real core `Orchestrator`, registers the
 * Cowork worker pool + the `task_assigned` listener (mirroring
 * `WorkflowBridge.ensureOrchestrator`), and runs a full workflow
 * compiled from a visual DAG.
 *
 * This catches the bugs the unit tests can't:
 *  1. The orchestrator deadlock if `processQueue` isn't triggered after
 *     `queueTask`.
 *  2. The listener-order issue where the global `workflow_started`
 *     listener would fire before the run-scoped capture handler.
 *
 * We don't import `WorkflowBridge` directly because it pulls in
 * `electron.app.getPath`, which is mocked but not as functional as a
 * real userData path. Instead we replicate the bridge's wiring inline.
 */
import { describe, expect, it } from 'vitest';
import { Orchestrator } from '../../src/orchestration/orchestrator.js';
import {
  CoworkToolAgent,
  COWORK_TOOL_AGENT_ID,
  type FormalToolRegistryLike,
} from '../src/main/workflows/cowork-tool-agent';
import { compileVisualToCore } from '../src/main/workflows/dag-compiler';
import type {
  WorkflowVisualDefinition,
  WorkflowEventPayload,
} from '../src/shared/workflow-types';

interface BridgeFixture {
  orchestrator: InstanceType<typeof Orchestrator>;
  events: WorkflowEventPayload[];
  toolAgent: CoworkToolAgent;
  registryCalls: Array<{ name: string; input: Record<string, unknown> }>;
  run: (
    visual: WorkflowVisualDefinition,
    workflowId: string
  ) => Promise<{
    instance: { instanceId: string; status: string; output?: Record<string, unknown> };
    workflowId: string;
  }>;
}

function setupBridgeLikeFixture(): BridgeFixture {
  const events: WorkflowEventPayload[] = [];
  const registryCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const registry: FormalToolRegistryLike = {
    execute: async (name, input) => {
      registryCalls.push({ name, input });
      return {
        success: true,
        output: { stdout: `${name} ok` },
        toolName: name,
        duration: 1,
      };
    },
  };

  const orchestrator = new Orchestrator({ maxAgents: 4, logLevel: 'warn' });
  const toolAgent = new CoworkToolAgent({
    registry,
    onApprovalRequired: () => {
      // Tests that need approvals install their own handler before running.
    },
  });

  // Worker pool — 4 agents (mirrors WorkflowBridge.ensureOrchestrator).
  const POOL = 4;
  for (let i = 0; i < POOL; i++) {
    orchestrator.registerAgent({
      id: i === 0 ? COWORK_TOOL_AGENT_ID : `${COWORK_TOOL_AGENT_ID}-${i}`,
      name: `Cowork Tool Runner ${i}`,
      role: 'executor',
      description: 'integration test runner',
      capabilities: {
        tools: [],
        maxConcurrency: 1,
        taskTypes: ['tool_invoke', 'approval_wait'],
      },
    });
  }

  // Active run state for tagging events.
  let currentRun: { workflowId: string; instanceId: string } | null = null;

  // Trigger processQueue after task_created (deferred so queueTask runs first).
  orchestrator.on('task_created', () => {
    queueMicrotask(() => orchestrator.processQueue());
  });

  // Task assignment dispatcher.
  orchestrator.on('task_assigned', async (...args: unknown[]) => {
    const evt = args[0] as { taskId: string; agentId: string };
    if (!evt.agentId.startsWith(COWORK_TOOL_AGENT_ID)) return;
    const task = orchestrator.getTask(evt.taskId);
    if (!task) return;
    const visualNodeId = task.definition.input.cowork_visual_node_id as
      | string
      | undefined;
    const workflowId = currentRun?.workflowId ?? '';
    const instanceId = currentRun?.instanceId ?? '';
    if (visualNodeId) {
      events.push({
        type: 'node_started',
        workflowId,
        instanceId,
        nodeId: visualNodeId,
      });
    }
    try {
      let output: Record<string, unknown>;
      if (task.definition.type === 'tool_invoke') {
        output = await toolAgent.runToolInvoke(task.definition.input);
      } else if (task.definition.type === 'approval_wait') {
        output = await toolAgent.runApprovalWait(task.definition.input, instanceId);
      } else {
        throw new Error(`unsupported ${task.definition.type}`);
      }
      orchestrator.completeTask(evt.taskId, output);
      if (visualNodeId) {
        events.push({
          type: 'node_completed',
          workflowId,
          instanceId,
          nodeId: visualNodeId,
          output,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      orchestrator.failTask(evt.taskId, message);
      if (visualNodeId) {
        events.push({
          type: 'node_failed',
          workflowId,
          instanceId,
          nodeId: visualNodeId,
          error: message,
        });
      }
    }
  });

  // Global lifecycle (registered FIRST — captureHandler in run() must
  // prependListener to ensure mapping is set before this fires).
  orchestrator.on('workflow_started', (...args: unknown[]) => {
    const evt = args[0] as { instanceId: string };
    events.push({
      type: 'started',
      workflowId: currentRun?.workflowId ?? '',
      instanceId: evt.instanceId,
    });
  });

  orchestrator.start();

  const run = async (visual: WorkflowVisualDefinition, workflowId: string) => {
    const coreDef = compileVisualToCore(visual);

    // Run-scoped captureHandler — prepended so it runs BEFORE the global
    // lifecycle listener.
    let captured = false;
    const captureHandler = (...args: unknown[]): void => {
      if (captured) return;
      captured = true;
      const evt = args[0] as { instanceId: string };
      currentRun = { workflowId, instanceId: evt.instanceId };
    };
    orchestrator.prependListener('workflow_started', captureHandler);

    try {
      const instance = await orchestrator.startWorkflow(
        coreDef as unknown as Record<string, unknown>,
        {}
      );
      events.push({
        type: instance.status === 'completed' ? 'completed' : 'failed',
        workflowId,
        instanceId: instance.instanceId,
        ...(instance.status === 'completed'
          ? { output: instance.output ?? {} }
          : { error: instance.error ?? 'failed' }),
      } as WorkflowEventPayload);
      return { instance, workflowId };
    } finally {
      orchestrator.removeListener('workflow_started', captureHandler);
      currentRun = null;
    }
  };

  return { orchestrator, events, toolAgent, registryCalls, run };
}

const node = (
  id: string,
  type: string,
  config?: Record<string, unknown>
): WorkflowVisualDefinition['nodes'][number] => ({
  id,
  type: type as WorkflowVisualDefinition['nodes'][number]['type'],
  name: id,
  position: { x: 0, y: 0 },
  config,
});

const edge = (source: string, target: string, label?: 'true' | 'false') => ({
  id: `${source}-${target}`,
  source,
  target,
  label,
});

describe('workflow-bridge integration (real Orchestrator)', () => {
  it(
    'runs a single tool node end-to-end (covers bug 1 — processQueue trigger)',
    async () => {
      const fixture = setupBridgeLikeFixture();

      const visual: WorkflowVisualDefinition = {
        id: 'wf_int',
        name: 'integration',
        nodes: [
          node('start', 'start'),
          node('t1', 'tool', { toolName: 'bash_run', toolInput: { command: 'echo hi' } }),
          node('end', 'end'),
        ],
        edges: [edge('start', 't1'), edge('t1', 'end')],
      };

      const { instance } = await fixture.run(visual, 'wf_int');

      expect(instance.status).toBe('completed');
      expect(fixture.registryCalls).toEqual([
        { name: 'bash_run', input: { command: 'echo hi' } },
      ]);
      const nodeEvents = fixture.events.filter(
        (e) => e.type === 'node_started' || e.type === 'node_completed'
      );
      expect(nodeEvents.map((e) => `${e.type}:${(e as { nodeId: string }).nodeId}`)).toEqual([
        'node_started:t1',
        'node_completed:t1',
      ]);
    },
    10000 // 10 s — well under the 5-min waitForTask timeout the bug would hit
  );

  it(
    'tags workflow_started with the right workflowId (covers bug 2 — listener order)',
    async () => {
      const fixture = setupBridgeLikeFixture();
      const visual: WorkflowVisualDefinition = {
        id: 'wf_lo',
        name: 'listener order',
        nodes: [
          node('start', 'start'),
          node('t1', 'tool', { toolName: 'noop', toolInput: {} }),
          node('end', 'end'),
        ],
        edges: [edge('start', 't1'), edge('t1', 'end')],
      };

      await fixture.run(visual, 'wf_lo');

      const startedEvent = fixture.events.find((e) => e.type === 'started');
      expect(startedEvent).toBeDefined();
      expect((startedEvent as { workflowId: string }).workflowId).toBe('wf_lo');
    },
    10000
  );

  it(
    'runs two parallel tool nodes (parallel branches converge to end)',
    async () => {
      const fixture = setupBridgeLikeFixture();
      const visual: WorkflowVisualDefinition = {
        id: 'wf_par',
        name: 'parallel',
        nodes: [
          node('start', 'start'),
          node('p', 'parallel'),
          node('a', 'tool', { toolName: 'bash_run', toolInput: { command: 'a' } }),
          node('b', 'tool', { toolName: 'bash_run', toolInput: { command: 'b' } }),
          node('end', 'end'),
        ],
        edges: [
          edge('start', 'p'),
          edge('p', 'a'),
          edge('p', 'b'),
          edge('a', 'end'),
          edge('b', 'end'),
        ],
      };

      const { instance } = await fixture.run(visual, 'wf_par');
      expect(instance.status).toBe('completed');
      const completed = fixture.events.filter((e) => e.type === 'node_completed');
      const ids = new Set(
        completed.map((e) => (e as { nodeId: string }).nodeId)
      );
      expect(ids).toEqual(new Set(['a', 'b']));
    },
    10000
  );

  it(
    'pauses on approval, resumes on resolveApproval(true)',
    async () => {
      const fixture = setupBridgeLikeFixture();
      // Override the agent's onApprovalRequired so we can resolve from the test.
      const visual: WorkflowVisualDefinition = {
        id: 'wf_apv',
        name: 'approval',
        nodes: [
          node('start', 'start'),
          node('apv', 'approval'),
          node('go', 'tool', { toolName: 'bash_run', toolInput: { command: 'go' } }),
          node('end', 'end'),
        ],
        edges: [edge('start', 'apv'), edge('apv', 'go'), edge('go', 'end')],
      };

      const runPromise = fixture.run(visual, 'wf_apv');

      // Wait one microtask cycle for the approval to be requested.
      await new Promise((r) => setTimeout(r, 50));
      expect(fixture.toolAgent.pendingCount()).toBe(1);

      // Approve it.
      const matched = fixture.toolAgent.resolveApproval('apv', true);
      expect(matched).toBe(true);

      const { instance } = await runPromise;
      expect(instance.status).toBe('completed');
      const completedNodes = fixture.events
        .filter((e) => e.type === 'node_completed')
        .map((e) => (e as { nodeId: string }).nodeId);
      expect(completedNodes).toEqual(['apv', 'go']);
    },
    10000
  );
});
