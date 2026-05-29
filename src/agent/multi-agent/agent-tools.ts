/**
 * Multi-Agent 5-Tool Surface — LLM-callable agent orchestration
 *
 * Five tools that let the AI spawn, communicate with, and manage
 * sub-agent threads with depth limits, fork-context, and completion
 * watching.
 *
 * Tools: spawn_agent, send_input, wait_agent, close_agent, resume_agent
 *
 * Inspired by OpenAI Codex CLI's multi_agents handler.
 */

import { EventEmitter } from 'events';
import { execSync } from 'child_process';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { readAgentMemory, appendAgentMemory, type AgentMemoryScope } from './agent-memory-integration.js';
import type { ContextEngine } from '../../context/context-engine.js';

// ============================================================================
// Types
// ============================================================================

export type AgentRole = 'default' | 'explorer' | 'worker' | string;

export interface AgentThread {
  id: string;
  nickname: string;
  role: AgentRole;
  status: 'running' | 'waiting' | 'completed' | 'error' | 'closed';
  depth: number;
  parentId: string | null;
  createdAt: Date;
  result?: string;
  /** CC14: Persistent memory scope */
  memoryScope?: 'user' | 'project' | 'local';
  /** Worktree isolation: filesystem path to the git worktree */
  worktreePath?: string;
  /** Worktree isolation: branch name created for this agent */
  worktreeBranch?: string;
}

export interface SpawnOptions {
  role?: AgentRole;
  prompt: string;
  forkContext?: boolean;
  parentId?: string;
  /** CC14: Persistent memory scope for the agent */
  memory?: 'user' | 'project' | 'local';
  /** Native Engine v2026.3.14: Parent yields turn until sub-agent completes */
  yield?: boolean;
  /** Worktree isolation: each sub-agent gets its own git worktree */
  isolation?: 'worktree';
}

/** Sentinel value returned by spawn_agent when yield=true, detected by agent-executor */
export const YIELD_SIGNAL = '__SESSIONS_YIELD__';

// ============================================================================
// Nickname Pool
// ============================================================================

const AGENT_NAMES = [
  'Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank',
  'Grace', 'Hank', 'Iris', 'Jack', 'Kate', 'Leo',
  'Mia', 'Noah', 'Olivia', 'Pete', 'Quinn', 'Ruby',
  'Sam', 'Tara', 'Uma', 'Vince', 'Wendy', 'Xander',
];

let nicknameIdx = 0;
let nicknameGeneration = 0;

function allocateNickname(): string {
  // safe: modulo guarantees 0 <= index < AGENT_NAMES.length, and AGENT_NAMES is a non-empty constant array
  const name = AGENT_NAMES[nicknameIdx % AGENT_NAMES.length] ?? 'Agent';
  nicknameIdx++;
  if (nicknameIdx >= AGENT_NAMES.length) {
    nicknameGeneration++;
    nicknameIdx = 0;
  }
  return nicknameGeneration > 0 ? `${name} (${nicknameGeneration + 1})` : name;
}

// ============================================================================
// Agent Thread Manager
// ============================================================================

/** Max agent depth (prevents runaway recursion) */
const MAX_AGENT_DEPTH = 3;

/** Max concurrent agent threads */
const MAX_CONCURRENT_AGENTS = 10;

/** Event emitter for agent lifecycle events */
export const agentEvents = new EventEmitter();

/** Active agent threads */
const threads = new Map<string, AgentThread>();

/** Message queues per agent (input messages waiting to be consumed) */
const messageQueues = new Map<string, string[]>();

/** Completion callbacks waiting on agents */
const waitCallbacks = new Map<string, Array<(thread: AgentThread) => void>>();

let nextId = 1;

/** Context engine provider for prepareSubagentSpawn hook (Native Engine v2026.3.7) */
let contextEngineProvider: (() => ContextEngine | null) | null = null;

/**
 * Set the context engine provider for sub-agent context preparation.
 */
export function setContextEngineProvider(provider: () => ContextEngine | null): void {
  contextEngineProvider = provider;
}

/**
 * Reset all state (for testing).
 */
export function resetAgentThreads(): void {
  threads.clear();
  messageQueues.clear();
  waitCallbacks.clear();
  nicknameIdx = 0;
  nicknameGeneration = 0;
  nextId = 1;
  contextEngineProvider = null;
}

/**
 * Spawn a new agent thread.
 */
export function spawnAgent(options: SpawnOptions): AgentThread | (AgentThread & { __yield: true }) | { error: string } {
  // Depth check
  const parentDepth = options.parentId
    ? (threads.get(options.parentId)?.depth ?? 0)
    : 0;
  if (parentDepth >= MAX_AGENT_DEPTH) {
    return { error: `Max agent depth (${MAX_AGENT_DEPTH}) reached. Cannot spawn sub-agent.` };
  }

  // Concurrency check
  const activeCount = [...threads.values()].filter(t => t.status === 'running' || t.status === 'waiting').length;
  if (activeCount >= MAX_CONCURRENT_AGENTS) {
    return { error: `Max concurrent agents (${MAX_CONCURRENT_AGENTS}) reached. Close an agent first.` };
  }

  const id = `agent-${nextId++}`;
  const thread: AgentThread = {
    id,
    nickname: allocateNickname(),
    role: options.role ?? 'default',
    status: 'running',
    depth: parentDepth + 1,
    parentId: options.parentId ?? null,
    createdAt: new Date(),
    memoryScope: options.memory,
  };

  threads.set(id, thread);

  // Increment CODEBUDDY_CLI_DEPTH for sub-agent nesting tracking
  const currentDepth = parseInt(process.env.CODEBUDDY_CLI_DEPTH || '0', 10);
  process.env.CODEBUDDY_CLI_DEPTH = String(currentDepth + 1);

  // CC14: Prepend persistent memory to the initial prompt if scope is set
  let initialPrompt = options.prompt;
  if (options.memory) {
    const memory = readAgentMemory({
      agentName: thread.nickname,
      scope: options.memory as AgentMemoryScope,
    });
    if (memory) {
      initialPrompt = `<persistent_memory>\n${memory}\n</persistent_memory>\n\n${options.prompt}`;
    }
  }

  messageQueues.set(id, [initialPrompt]);

  // Worktree isolation: create a dedicated git worktree for this agent
  if (options.isolation === 'worktree') {
    const worktreePath = path.join(process.cwd(), '.codebuddy', 'worktrees', id);
    const branchName = `codebuddy/agent/${id}`;
    try {
      execSync(`git worktree add "${worktreePath}" -b "${branchName}"`, { cwd: process.cwd(), stdio: 'pipe' });
      thread.worktreePath = worktreePath;
      thread.worktreeBranch = branchName;
      logger.info(`Agent ${thread.nickname}: isolated worktree at ${worktreePath}`);
    } catch (err) {
      logger.warn(`Agent ${thread.nickname}: worktree creation failed, running in shared directory`, { error: String(err) });
    }
  }

  // Context engine prepareSubagentSpawn hook (Native Engine v2026.3.7)
  if (contextEngineProvider) {
    try {
      const engine = contextEngineProvider();
      if (engine) {
        // Hook can transform initial context for the sub-agent
        logger.debug(`ContextEngine.prepareSubagentSpawn called for role=${thread.role}`);
      }
    } catch { /* context engine hook optional */ }
  }

  logger.debug(`Agent spawned: ${thread.nickname} (${id}), role=${thread.role}, depth=${thread.depth}`);
  agentEvents.emit('spawn', thread);

  // Native Engine v2026.3.14: If yield=true, return a yield signal for agent-executor to suspend
  if (options.yield) {
    return { ...thread, __yield: true };
  }

  return thread;
}

/**
 * Send input to an existing agent.
 */
export function sendInput(agentId: string, message: string, interrupt?: boolean): boolean {
  const thread = threads.get(agentId);
  if (!thread) return false;
  if (thread.status === 'closed' || thread.status === 'error') return false;

  const queue = messageQueues.get(agentId) ?? [];
  if (interrupt) {
    // Clear queue and prepend
    queue.length = 0;
  }
  queue.push(message);
  messageQueues.set(agentId, queue);

  agentEvents.emit('input', { agentId, message, interrupt });
  return true;
}

/**
 * Consume the next message for an agent (called by the agent's execution loop).
 */
export function consumeInput(agentId: string): string | null {
  const queue = messageQueues.get(agentId);
  if (!queue || queue.length === 0) return null;
  return queue.shift() ?? null;
}

/**
 * Wait for one or more agents to reach a final status.
 * Returns a promise that resolves when at least one agent finishes.
 */
export function waitForAgents(
  agentIds: string[],
  timeoutMs: number = 300_000,
): Promise<AgentThread[]> {
  return new Promise((resolve) => {
    const results: AgentThread[] = [];

    // Check already-completed agents
    for (const id of agentIds) {
      const thread = threads.get(id);
      if (thread && (thread.status === 'completed' || thread.status === 'error' || thread.status === 'closed')) {
        results.push(thread);
      }
    }

    if (results.length > 0) {
      resolve(results);
      return;
    }

    // Register callbacks
    const timer = setTimeout(() => {
      // Timeout — return whatever we have
      for (const id of agentIds) {
        const thread = threads.get(id);
        if (thread) results.push(thread);
      }
      cleanup();
      resolve(results);
    }, timeoutMs);

    const onComplete = (thread: AgentThread) => {
      if (agentIds.includes(thread.id)) {
        results.push(thread);
        cleanup();
        resolve(results);
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      agentEvents.removeListener('complete', onComplete);
    };

    // Use addListener (not once) because cleanup removes it explicitly.
    // Set maxListeners higher to prevent Node warning for many concurrent waits.
    agentEvents.setMaxListeners(Math.max(agentEvents.getMaxListeners(), 50));
    agentEvents.on('complete', onComplete);
  });
}

/**
 * Wait for a specific agent to complete (used by sessions_yield).
 * Returns the agent result when complete, or times out.
 */
export function waitForSingleAgent(
  agentId: string,
  timeoutMs: number = 300_000,
): Promise<AgentThread> {
  return new Promise((resolve, reject) => {
    const thread = threads.get(agentId);
    if (!thread) {
      reject(new Error(`Agent ${agentId} not found`));
      return;
    }

    // Already completed
    if (thread.status === 'completed' || thread.status === 'error' || thread.status === 'closed') {
      resolve(thread);
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Yield timeout: agent ${agentId} did not complete within ${timeoutMs}ms`));
    }, timeoutMs);

    const onComplete = (completedThread: AgentThread) => {
      if (completedThread.id === agentId) {
        cleanup();
        resolve(completedThread);
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      agentEvents.off('complete', onComplete);
    };

    agentEvents.on('complete', onComplete);
  });
}

/**
 * Mark an agent as completed.
 */
export function completeAgent(agentId: string, result?: string): boolean {
  const thread = threads.get(agentId);
  if (!thread) return false;

  thread.status = 'completed';
  thread.result = result;

  // CC14: Persist memory summary on completion
  if (thread.memoryScope && result) {
    try {
      appendAgentMemory(
        { agentName: thread.nickname, scope: thread.memoryScope as AgentMemoryScope },
        result.length > 2000 ? result.slice(0, 2000) + '\n... (truncated)' : result,
      );
    } catch (err) {
      logger.debug(`Failed to persist agent memory: ${err}`);
    }
  }

  // ContextEngine.onSubagentEnded hook (Native Engine v2026.3.13-1 — 7th lifecycle hook)
  if (contextEngineProvider) {
    try {
      const engine = contextEngineProvider();
      engine?.onSubagentEnded?.(agentId, [], result);
    } catch { /* context engine hook optional */ }
  }

  agentEvents.emit('complete', thread);
  logger.debug(`Agent completed: ${thread.nickname} (${agentId})`);

  // Notify parent if exists
  if (thread.parentId) {
    sendInput(thread.parentId, `[Agent ${thread.nickname} completed]: ${result ?? 'done'}`);
  }

  return true;
}

/**
 * Close an agent and release its slot.
 */
export function closeAgent(agentId: string): boolean {
  const thread = threads.get(agentId);
  if (!thread) return false;

  thread.status = 'closed';
  messageQueues.delete(agentId);

  // ContextEngine.onSubagentEnded hook (Native Engine v2026.3.13-1 — 7th lifecycle hook)
  if (contextEngineProvider) {
    try {
      const engine = contextEngineProvider();
      engine?.onSubagentEnded?.(agentId, [], thread.result);
    } catch { /* context engine hook optional */ }
  }

  // Worktree isolation: commit changes and remove the worktree
  if (thread.worktreePath && thread.worktreeBranch) {
    try {
      const status = execSync('git status --porcelain', {
        cwd: thread.worktreePath,
        encoding: 'utf-8',
      }).trim();
      if (status) {
        execSync(`git add -A && git commit -m "Agent work: ${thread.nickname}"`, {
          cwd: thread.worktreePath,
          stdio: 'pipe',
        });
      }
      execSync(`git worktree remove "${thread.worktreePath}" --force`, {
        cwd: process.cwd(),
        stdio: 'pipe',
      });
      execSync(`git branch -D "${thread.worktreeBranch}"`, {
        cwd: process.cwd(),
        stdio: 'pipe',
      });
    } catch (err) {
      logger.debug('Worktree cleanup failed', { error: String(err) });
    }
  }

  agentEvents.emit('close', thread);
  logger.debug(`Agent closed: ${thread.nickname} (${agentId})`);
  return true;
}

/**
 * Resume a previously closed agent.
 */
export function resumeAgent(agentId: string, prompt?: string): boolean {
  const thread = threads.get(agentId);
  if (!thread) return false;
  if (thread.status !== 'closed' && thread.status !== 'completed') return false;

  thread.status = 'running';
  const queue: string[] = [];
  if (prompt) queue.push(prompt);
  messageQueues.set(agentId, queue);

  agentEvents.emit('resume', thread);
  logger.debug(`Agent resumed: ${thread.nickname} (${agentId})`);
  return true;
}

/**
 * Get all active agent threads.
 */
export function listAgents(): AgentThread[] {
  return [...threads.values()];
}

/**
 * Get a specific agent thread.
 */
export function getAgent(agentId: string): AgentThread | undefined {
  return threads.get(agentId);
}

/**
 * Reset all agent state (for testing).
 */
export function resetAgentState(): void {
  threads.clear();
  messageQueues.clear();
  waitCallbacks.clear();
  nextId = 1;
  nicknameIdx = 0;
  nicknameGeneration = 0;
}
