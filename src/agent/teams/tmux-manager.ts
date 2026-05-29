/**
 * Tmux Session Manager (CC16)
 *
 * Manages tmux sessions for Agent Teams, providing visual multi-pane
 * environments where each agent runs in its own pane.
 *
 * Falls back to in-process execution if tmux is not available.
 */

import { execSync, execFileSync } from 'child_process';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface TmuxPane {
  /** Pane index within the session */
  index: number;
  /** Agent name assigned to this pane */
  agentName: string;
  /** Whether the pane is currently active */
  active: boolean;
}

export interface TmuxSession {
  /** Session name */
  name: string;
  /** Panes in the session */
  panes: TmuxPane[];
  /** Whether the session was created by us */
  managed: boolean;
}

// ============================================================================
// Tmux Detection
// ============================================================================

let _tmuxAvailable: boolean | null = null;

/**
 * Check if tmux is available on the system.
 */
export function isTmuxAvailable(): boolean {
  if (_tmuxAvailable !== null) return _tmuxAvailable;

  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    execSync(`${cmd} tmux`, { stdio: 'pipe', encoding: 'utf-8' });
    _tmuxAvailable = true;
  } catch {
    _tmuxAvailable = false;
  }

  return _tmuxAvailable;
}

/**
 * Reset the tmux availability cache (for testing).
 */
export function resetTmuxCache(): void {
  _tmuxAvailable = null;
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Create a new tmux session for a team.
 *
 * @param sessionName - Name for the tmux session
 * @param agentNames - Agent names to create panes for
 * @returns The created session, or null if tmux is unavailable
 */
export function createTeamSession(
  sessionName: string,
  agentNames: string[],
): TmuxSession | null {
  if (!isTmuxAvailable()) {
    logger.debug('Tmux not available, falling back to in-process mode');
    return null;
  }

  const safeName = sessionName.replace(/[^a-zA-Z0-9_-]/g, '_');

  try {
    // Check if session already exists
    try {
      execFileSync('tmux', ['has-session', '-t', safeName], { stdio: 'pipe' });
      // Session exists, kill it first
      execFileSync('tmux', ['kill-session', '-t', safeName], { stdio: 'pipe' });
    } catch {
      // Session doesn't exist, that's fine
    }

    // Create new session with the first agent
    execFileSync('tmux', [
      'new-session', '-d', '-s', safeName, '-n', agentNames[0] || 'lead',
    ], { stdio: 'pipe' });

    const panes: TmuxPane[] = [{
      index: 0,
      agentName: agentNames[0] || 'lead',
      active: true,
    }];

    // Split window for each additional agent
    for (let i = 1; i < agentNames.length; i++) {
      execFileSync('tmux', [
        'split-window', '-t', safeName, '-h',
      ], { stdio: 'pipe' });

      panes.push({
        index: i,
        agentName: agentNames[i] ?? `agent-${i}`,
        active: false,
      });
    }

    // Tile panes evenly
    try {
      execFileSync('tmux', [
        'select-layout', '-t', safeName, 'tiled',
      ], { stdio: 'pipe' });
    } catch {
      // Layout may fail with few panes, that's ok
    }

    logger.debug(`Tmux session created: ${safeName} with ${panes.length} panes`);

    return {
      name: safeName,
      panes,
      managed: true,
    };
  } catch (err) {
    logger.debug(`Failed to create tmux session: ${err}`);
    return null;
  }
}

/**
 * Send a command to a specific pane in a tmux session.
 */
export function sendToPane(
  sessionName: string,
  paneIndex: number,
  command: string,
): boolean {
  if (!isTmuxAvailable()) return false;

  try {
    execFileSync('tmux', [
      'send-keys', '-t', `${sessionName}:0.${paneIndex}`, command, 'Enter',
    ], { stdio: 'pipe' });
    return true;
  } catch (err) {
    logger.debug(`Failed to send to pane ${paneIndex}: ${err}`);
    return false;
  }
}

/**
 * Read the current output from a tmux pane.
 */
export function capturePaneOutput(
  sessionName: string,
  paneIndex: number,
  lines: number = 50,
): string {
  if (!isTmuxAvailable()) return '';

  try {
    return execFileSync('tmux', [
      'capture-pane', '-t', `${sessionName}:0.${paneIndex}`, '-p', '-S', `-${lines}`,
    ], { stdio: 'pipe', encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

/**
 * Kill a tmux session.
 */
export function killTeamSession(sessionName: string): boolean {
  if (!isTmuxAvailable()) return false;

  const safeName = sessionName.replace(/[^a-zA-Z0-9_-]/g, '_');

  try {
    execFileSync('tmux', ['kill-session', '-t', safeName], { stdio: 'pipe' });
    logger.debug(`Tmux session killed: ${safeName}`);
    return true;
  } catch (err) {
    logger.debug(`Failed to kill tmux session: ${err}`);
    return false;
  }
}

/**
 * List active tmux sessions (if any).
 */
export function listTmuxSessions(): string[] {
  if (!isTmuxAvailable()) return [];

  try {
    const output = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

// ============================================================================
// In-Process Fallback
// ============================================================================

/**
 * In-process team session (used when tmux is unavailable).
 * Provides the same interface but agents run in the same process.
 */
export class InProcessTeamSession {
  public readonly name: string;
  public readonly agents: Map<string, { status: string; output: string[] }> = new Map();

  constructor(name: string, agentNames: string[]) {
    this.name = name;
    for (const agent of agentNames) {
      this.agents.set(agent, { status: 'idle', output: [] });
    }
    logger.debug(`In-process team session created: ${name} with ${agentNames.length} agents`);
  }

  /**
   * Record output for an agent.
   */
  recordOutput(agentName: string, line: string): void {
    const agent = this.agents.get(agentName);
    if (agent) {
      agent.output.push(line);
      // Keep last 100 lines
      if (agent.output.length > 100) {
        agent.output.splice(0, agent.output.length - 100);
      }
    }
  }

  /**
   * Set agent status.
   */
  setStatus(agentName: string, status: string): void {
    const agent = this.agents.get(agentName);
    if (agent) {
      agent.status = status;
    }
  }

  /**
   * Get agent output.
   */
  getOutput(agentName: string, lines: number = 50): string {
    const agent = this.agents.get(agentName);
    if (!agent) return '';
    return agent.output.slice(-lines).join('\n');
  }

  /**
   * Format session status.
   */
  formatStatus(): string {
    const lines: string[] = [`Team Session: ${this.name} (in-process)`];
    for (const [name, agent] of this.agents) {
      lines.push(`  ${name}: ${agent.status} (${agent.output.length} output lines)`);
    }
    return lines.join('\n');
  }
}
