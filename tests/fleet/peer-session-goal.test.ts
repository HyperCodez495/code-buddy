/**
 * peer.chat-session.goal tests — Hermes gateway goal-loop parity.
 *
 * Validates:
 *   - goal attach/status/pause/resume/clear lifecycle on a peer session
 *   - mid-run rejection of a new goal while one is active
 *   - server-side judge after continue: verdict + continuationPrompt in the
 *     RPC response (caller-driven continuation)
 *   - budget exhaustion + done transitions
 *   - subgoal actions
 *   - goal persistence in the session store snapshot
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  dispatchPeerRequest,
  type PeerMethodContext,
} from '../../src/server/websocket/peer-rpc.js';
import {
  _unwireForTests,
  wirePeerSessionBridge,
} from '../../src/fleet/peer-session-bridge.js';
import {
  PeerSessionStore,
  _setPeerSessionStoreForTests,
  resetPeerSessionStore,
} from '../../src/fleet/peer-session-store.js';

vi.mock('../../src/server/websocket/fleet-bridge.js', () => ({
  broadcastChatSessionStart: vi.fn(),
  broadcastChatSessionTurn: vi.fn(),
  broadcastChatSessionEnd: vi.fn(),
  broadcastChatSessionGoal: vi.fn(),
}));

import { broadcastChatSessionGoal } from '../../src/server/websocket/fleet-bridge.js';

let storeTmpDir: string;

beforeEach(() => {
  storeTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-session-goal-test-'));
  _setPeerSessionStoreForTests(new PeerSessionStore({ storeDir: storeTmpDir }));
  vi.mocked(broadcastChatSessionGoal).mockClear();
  _unwireForTests();
});

afterEach(() => {
  _unwireForTests();
  resetPeerSessionStore();
  fs.rmSync(storeTmpDir, { recursive: true, force: true });
});

const baseCtx = (overrides: Partial<PeerMethodContext> = {}): PeerMethodContext => ({
  connectionId: 'test-conn',
  scopes: ['peer:invoke'],
  traceId: '',
  depth: 0,
  ...overrides,
});

/**
 * Client mock whose replies are consumed in order. With an active goal each
 * continue consumes TWO replies: the assistant turn, then the judge verdict.
 */
function makeClient(responses: string[]): { chat: ReturnType<typeof vi.fn> } {
  let i = 0;
  return {
    chat: vi.fn(async () => ({
      choices: [
        { message: { content: responses[Math.min(i++, responses.length - 1)] }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    })),
  };
}

async function dispatch(method: string, params: Record<string, unknown>) {
  return dispatchPeerRequest(
    { id: `req-${Math.random().toString(36).slice(2, 10)}`, method, params },
    baseCtx()
  );
}

async function startSession(client: { chat: unknown }): Promise<string> {
  await wirePeerSessionBridge(() => client as never);
  const res = await dispatch('peer.chat-session.start', {});
  expect(res.ok).toBe(true);
  return (res.payload as { sessionId: string }).sessionId;
}

describe('peer.chat-session.goal — lifecycle', () => {
  it('sets, reports, pauses, resumes, and clears a goal', async () => {
    const sessionId = await startSession(makeClient(['hi']));

    const set = await dispatch('peer.chat-session.goal', {
      sessionId,
      action: 'set',
      goal: 'summarize the repo',
      maxTurns: 4,
    });
    expect(set.ok).toBe(true);
    expect(set.payload).toMatchObject({ goal: 'summarize the repo', status: 'active', maxTurns: 4, turnsUsed: 0 });
    expect(vi.mocked(broadcastChatSessionGoal)).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId, status: 'active' })
    );

    const paused = await dispatch('peer.chat-session.goal', { sessionId, action: 'pause' });
    expect(paused.payload).toMatchObject({ status: 'paused', pausedReason: 'user-paused' });

    const resumed = await dispatch('peer.chat-session.goal', { sessionId, action: 'resume' });
    expect(resumed.payload).toMatchObject({ status: 'active', turnsUsed: 0 });

    const cleared = await dispatch('peer.chat-session.goal', { sessionId, action: 'clear' });
    expect(cleared.payload).toMatchObject({ cleared: true, status: 'none' });
  });

  it('rejects setting a new goal while one is active (Hermes mid-run rule)', async () => {
    const sessionId = await startSession(makeClient(['hi']));
    await dispatch('peer.chat-session.goal', { sessionId, action: 'set', goal: 'first goal' });

    const second = await dispatch('peer.chat-session.goal', { sessionId, action: 'set', goal: 'second goal' });
    expect(second.ok).toBe(false);
    expect(second.error?.message).toContain('GOAL_ACTIVE');
  });

  it('errors on unknown session or unknown action', async () => {
    const sessionId = await startSession(makeClient(['hi']));
    const missing = await dispatch('peer.chat-session.goal', { sessionId: 'sess_nope', action: 'status' });
    expect(missing.error?.message).toContain('SESSION_NOT_FOUND');

    const bad = await dispatch('peer.chat-session.goal', { sessionId, action: 'explode' });
    expect(bad.error?.message).toContain('unknown action');
  });

  it('manages subgoals', async () => {
    const sessionId = await startSession(makeClient(['hi']));
    await dispatch('peer.chat-session.goal', { sessionId, action: 'set', goal: 'g' });

    await dispatch('peer.chat-session.goal', { sessionId, action: 'subgoal-add', text: 'criterion A' });
    const listed = await dispatch('peer.chat-session.goal', { sessionId, action: 'subgoal-list' });
    expect((listed.payload as { rendered: string }).rendered).toBe('- 1. criterion A');

    const removed = await dispatch('peer.chat-session.goal', { sessionId, action: 'subgoal-remove', index: 1 });
    expect((removed.payload as { removed: string }).removed).toBe('criterion A');

    const outOfRange = await dispatch('peer.chat-session.goal', { sessionId, action: 'subgoal-remove', index: 9 });
    expect(outOfRange.error?.message).toContain('out of range');
  });
});

describe('peer.chat-session.goal — judge loop on continue', () => {
  it('judges after a turn and returns a continuation prompt on continue verdict', async () => {
    const client = makeClient([
      'I made some progress.',
      '{"done": false, "reason": "summary incomplete"}',
    ]);
    const sessionId = await startSession(client);
    await dispatch('peer.chat-session.goal', { sessionId, action: 'set', goal: 'summarize the repo' });

    const res = await dispatch('peer.chat-session.continue', { sessionId, prompt: 'go' });
    expect(res.ok).toBe(true);
    const payload = res.payload as { text: string; goal?: Record<string, unknown> };
    expect(payload.text).toBe('I made some progress.');
    expect(payload.goal).toMatchObject({
      status: 'active',
      verdict: 'continue',
      reason: 'summary incomplete',
      turnsUsed: 1,
    });
    expect(String(payload.goal?.continuationPrompt)).toContain('[Continuing toward your standing goal]');
    expect(String(payload.goal?.message)).toContain('↻ Continuing toward goal (1/');
    expect(vi.mocked(broadcastChatSessionGoal)).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId, verdict: 'continue', turnsUsed: 1 })
    );
    // Two LLM calls: the turn + the judge.
    expect(client.chat).toHaveBeenCalledTimes(2);
  });

  it('marks the goal done and omits the continuation prompt', async () => {
    const client = makeClient(['All done.', '{"done": true, "reason": "delivered"}']);
    const sessionId = await startSession(client);
    await dispatch('peer.chat-session.goal', { sessionId, action: 'set', goal: 'g' });

    const res = await dispatch('peer.chat-session.continue', { sessionId, prompt: 'go' });
    const goal = (res.payload as { goal: Record<string, unknown> }).goal;
    expect(goal).toMatchObject({ status: 'done', verdict: 'done' });
    expect(goal.continuationPrompt).toBeUndefined();
    expect(String(goal.message)).toContain('✓ Goal achieved: delivered');

    // Next turn: goal no longer active → no judge call, no goal report.
    const after = await dispatch('peer.chat-session.continue', { sessionId, prompt: 'thanks' });
    expect((after.payload as { goal?: unknown }).goal).toBeUndefined();
  });

  it('auto-pauses when the turn budget is exhausted', async () => {
    const client = makeClient(['progress', '{"done": false, "reason": "not yet"}']);
    const sessionId = await startSession(client);
    await dispatch('peer.chat-session.goal', { sessionId, action: 'set', goal: 'g', maxTurns: 1 });

    const res = await dispatch('peer.chat-session.continue', { sessionId, prompt: 'go' });
    const goal = (res.payload as { goal: Record<string, unknown> }).goal;
    expect(goal).toMatchObject({ status: 'paused', turnsUsed: 1, maxTurns: 1 });
    expect(String(goal.message)).toContain('⏸ Goal paused — 1/1 turns used');
  });

  it('turns without a goal carry no goal report and call the LLM once', async () => {
    const client = makeClient(['plain answer']);
    const sessionId = await startSession(client);
    const res = await dispatch('peer.chat-session.continue', { sessionId, prompt: 'hello' });
    expect((res.payload as { goal?: unknown }).goal).toBeUndefined();
    expect(client.chat).toHaveBeenCalledTimes(1);
  });

  it('persists goal state to the session store across turns', async () => {
    const client = makeClient(['progress', '{"done": false, "reason": "keep going"}']);
    const sessionId = await startSession(client);
    await dispatch('peer.chat-session.goal', { sessionId, action: 'set', goal: 'g' });
    await dispatch('peer.chat-session.continue', { sessionId, prompt: 'go' });

    const persisted = await new PeerSessionStore({ storeDir: storeTmpDir }).load(sessionId);
    expect(persisted?.goal).toMatchObject({
      goal: 'g',
      status: 'active',
      turnsUsed: 1,
      lastVerdict: 'continue',
      lastReason: 'keep going',
    });
  });
});
