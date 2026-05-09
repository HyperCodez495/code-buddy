/**
 * SubAgentBridge — Claude Cowork parity
 *
 * Wraps Code Buddy's multi-agent agent-tools module and translates its
 * event stream into Cowork ServerEvents (subagent.spawned, subagent.status,
 * subagent.completed, subagent.output).
 *
 * @module main/agent/sub-agent-bridge
 */

import { log, logError, logWarn } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';
import type { ServerEvent } from '../../renderer/types';

export type SubAgentRole = 'default' | 'explorer' | 'worker' | string;

export type SubAgentStatus = 'running' | 'waiting' | 'completed' | 'error' | 'closed';

export interface SubAgent {
  id: string;
  nickname: string;
  role: SubAgentRole;
  status: SubAgentStatus;
  depth: number;
  parentId: string | null;
  createdAt: number;
  result?: string;
  sessionId?: string;
}

export interface SubAgentSpawnOptions {
  role?: SubAgentRole;
  prompt: string;
  forkContext?: boolean;
  parentId?: string;
  memory?: 'user' | 'project' | 'local';
  sessionId?: string;
}

// Type signature for the core module (lazy-imported)
type AgentToolsModule = {
  spawnAgent: (options: {
    role?: string;
    prompt: string;
    forkContext?: boolean;
    parentId?: string;
    memory?: 'user' | 'project' | 'local';
  }) => Promise<{
    id: string;
    nickname: string;
    role: string;
    status: string;
    depth: number;
    parentId: string | null;
    createdAt: Date;
  } | { error: string }> | {
    id: string;
    nickname: string;
    role: string;
    status: string;
    depth: number;
    parentId: string | null;
    createdAt: Date;
  } | { error: string };
  sendInput: (agentId: string, message: string, interrupt?: boolean) => boolean;
  waitForAgents: (
    agentIds: string[],
    timeoutMs?: number
  ) => Promise<Array<{ id: string; nickname: string; status: string; result?: string }>>;
  closeAgent: (agentId: string) => boolean;
  resumeAgent: (agentId: string, prompt?: string) => boolean;
  listAgents: () => Array<{
    id: string;
    nickname: string;
    role: string;
    status: string;
    depth: number;
    parentId: string | null;
    createdAt: Date;
    result?: string;
  }>;
  getAgent: (agentId: string) => {
    id: string;
    nickname: string;
    role: string;
    status: string;
    depth: number;
    parentId: string | null;
    createdAt: Date;
    result?: string;
  } | undefined;
  agentEvents: {
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    off: (event: string, listener: (...args: unknown[]) => void) => void;
  };
};

let cachedModule: AgentToolsModule | null = null;

async function loadModule(): Promise<AgentToolsModule | null> {
  if (cachedModule) return cachedModule;
  const mod = await loadCoreModule<AgentToolsModule>('agent/multi-agent/agent-tools.js');
  if (mod) {
    cachedModule = mod;
    log('[SubAgentBridge] Core agent-tools module loaded');
  } else {
    logWarn('[SubAgentBridge] Core agent-tools module unavailable');
  }
  return mod;
}

export class SubAgentBridge {
  private sendToRenderer: (event: ServerEvent) => void;
  /** Map agentId → sessionId for event routing */
  private agentToSession = new Map<string, string>();
  private eventListenersAttached = false;

  constructor(sendToRenderer: (event: ServerEvent) => void) {
    this.sendToRenderer = sendToRenderer;
  }

  /** Initialize the bridge, attach event listeners */
  async init(): Promise<void> {
    const mod = await loadModule();
    if (!mod) return;
    if (this.eventListenersAttached) return;
    this.eventListenersAttached = true;

    try {
      mod.agentEvents.on('status-changed', (...args: unknown[]) => {
        const thread = args[0] as {
          id: string;
          nickname: string;
          status: string;
          role: string;
        } | undefined;
        if (!thread) return;
        const sessionId = this.agentToSession.get(thread.id);
        if (!sessionId) return;
        this.sendToRenderer({
          type: 'subagent.status',
          payload: {
            sessionId,
            agentId: thread.id,
            status: thread.status as SubAgentStatus,
            nickname: thread.nickname,
          },
        });
      });

      mod.agentEvents.on('completed', (...args: unknown[]) => {
        const thread = args[0] as {
          id: string;
          nickname: string;
          result?: string;
        } | undefined;
        if (!thread) return;
        const sessionId = this.agentToSession.get(thread.id);
        if (!sessionId) return;
        this.sendToRenderer({
          type: 'subagent.completed',
          payload: {
            sessionId,
            agentId: thread.id,
            nickname: thread.nickname,
            result: thread.result ?? '',
          },
        });
        this.agentToSession.delete(thread.id);
      });

      log('[SubAgentBridge] Event listeners attached');
    } catch (err) {
      logError('[SubAgentBridge] Failed to attach event listeners:', err);
    }
  }

  /** Spawn a sub-agent and emit the corresponding events */
  async spawn(options: SubAgentSpawnOptions): Promise<SubAgent | { error: string }> {
    const mod = await loadModule();
    if (!mod) return { error: 'Multi-agent system unavailable' };

    try {
      const result = await Promise.resolve(
        mod.spawnAgent({
          role: options.role,
          prompt: options.prompt,
          forkContext: options.forkContext,
          parentId: options.parentId,
          memory: options.memory,
        })
      );

      if ('error' in result) {
        return { error: result.error };
      }

      const subAgent: SubAgent = {
        id: result.id,
        nickname: result.nickname,
        role: result.role as SubAgentRole,
        status: result.status as SubAgentStatus,
        depth: result.depth,
        parentId: result.parentId,
        createdAt: result.createdAt instanceof Date ? result.createdAt.getTime() : Date.now(),
        sessionId: options.sessionId,
      };

      if (options.sessionId) {
        this.agentToSession.set(subAgent.id, options.sessionId);
        this.sendToRenderer({
          type: 'subagent.spawned',
          payload: { sessionId: options.sessionId, subAgent },
        });
      }

      return subAgent;
    } catch (err) {
      logError('[SubAgentBridge] Spawn failed:', err);
      return { error: err instanceof Error ? err.message : 'Unknown spawn error' };
    }
  }

  /** Send input to an existing sub-agent */
  async sendInput(agentId: string, message: string, interrupt = false): Promise<boolean> {
    const mod = await loadModule();
    if (!mod) return false;
    return mod.sendInput(agentId, message, interrupt);
  }

  /** Wait for one or more sub-agents to complete */
  async wait(agentIds: string[], timeoutMs?: number): Promise<SubAgent[]> {
    const mod = await loadModule();
    if (!mod) return [];
    try {
      const results = await mod.waitForAgents(agentIds, timeoutMs);
      return results.map((r) => ({
        id: r.id,
        nickname: r.nickname,
        role: 'default',
        status: r.status as SubAgentStatus,
        depth: 0,
        parentId: null,
        createdAt: Date.now(),
        result: r.result,
      }));
    } catch (err) {
      logError('[SubAgentBridge] Wait failed:', err);
      return [];
    }
  }

  /** Close a sub-agent */
  async close(agentId: string): Promise<boolean> {
    const mod = await loadModule();
    if (!mod) return false;
    this.agentToSession.delete(agentId);
    return mod.closeAgent(agentId);
  }

  /** Resume a closed sub-agent */
  async resume(agentId: string, prompt?: string): Promise<boolean> {
    const mod = await loadModule();
    if (!mod) return false;
    return mod.resumeAgent(agentId, prompt);
  }

  /** List all active sub-agents */
  async list(): Promise<SubAgent[]> {
    const mod = await loadModule();
    if (!mod) return [];
    return mod.listAgents().map((t) => ({
      id: t.id,
      nickname: t.nickname,
      role: t.role as SubAgentRole,
      status: t.status as SubAgentStatus,
      depth: t.depth,
      parentId: t.parentId,
      createdAt: t.createdAt instanceof Date ? t.createdAt.getTime() : Date.now(),
      result: t.result,
    }));
  }
}

/**
 * Dry-run a sub-agent — spawn, await, close, return the captured
 * result. Used by `HooksBridge.testAgentHandler` to validate an
 * `agent`-type hook from the authoring UI without needing a full
 * SubAgentBridge instance attached to a renderer.
 */
export async function dryRunSubAgent(
  prompt: string,
  role: string | undefined,
  timeoutMs: number = 10_000
): Promise<{ status: SubAgentStatus; nickname: string; result?: string; error?: string; durationMs: number }> {
  const start = Date.now();
  // Use a no-op sendToRenderer — the dry-run consumer doesn't watch the
  // event stream, only the final result.
  const bridge = new SubAgentBridge(() => {});
  let agentId: string | null = null;
  try {
    const spawned = await bridge.spawn({
      prompt: `[DRY RUN] ${prompt}`,
      role: role as SubAgentRole,
      forkContext: false,
    });
    if ('error' in spawned) {
      return { status: 'error', nickname: '?', error: spawned.error, durationMs: Date.now() - start };
    }
    agentId = spawned.id;
    const completed = await bridge.wait([spawned.id], timeoutMs);
    const final = completed[0];
    if (!final) {
      return { status: 'error', nickname: spawned.nickname, error: 'Timeout (no result)', durationMs: Date.now() - start };
    }
    return {
      status: final.status,
      nickname: final.nickname,
      result: final.result,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      status: 'error',
      nickname: '?',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  } finally {
    if (agentId) {
      try {
        await bridge.close(agentId);
      } catch {
        /* best effort */
      }
    }
  }
}
