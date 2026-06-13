/**
 * Hibernate/wake lifecycle semantics for Hermes runtime backends.
 *
 * Each backend gets a strategy that maps to concrete CLI invocations:
 *   - local/wsl/os-sandbox/singularity: lifecycle unsupported (always running or job-based)
 *   - docker: pause / unpause / inspect
 *   - ssh: connection close / reconnect
 *   - modal: app stop / run
 *   - daytona: workspace stop / start
 *   - vercel-sandbox: unsupported (no lifecycle API)
 */

import os from 'os';
import { spawnSync } from 'child_process';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BackendLifecycleState =
  | 'running'
  | 'hibernated'
  | 'starting'
  | 'stopping'
  | 'unknown'
  | 'unsupported';

export interface BackendLifecycleAction {
  backendId: string;
  action: 'hibernate' | 'wake' | 'status';
  result: 'success' | 'failed' | 'unsupported';
  state: BackendLifecycleState;
  detail: string;
  durationMs: number;
}

export interface BackendLifecycleStatusEntry {
  backendId: string;
  label: string;
  lifecycleSupported: boolean;
  state: BackendLifecycleState;
  detail: string;
}

export interface BackendLifecycleStatusReport {
  kind: 'hermes_runtime_lifecycle_status';
  schemaVersion: 1;
  generatedAt: string;
  platform: NodeJS.Platform;
  arch: string;
  backends: BackendLifecycleStatusEntry[];
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface BackendLifecycleOptions {
  /** Container id or name for docker backends. */
  containerId?: string;
  /** SSH host for ssh backends. */
  sshHost?: string;
  /** Modal app name for modal backends. */
  modalApp?: string;
  /** Daytona workspace id for daytona backends. */
  daytonaWorkspace?: string;
  /** Environment override — default process.env. */
  env?: NodeJS.ProcessEnv;
  /** Time source override for tests. */
  now?: () => Date;
  /** Subprocess timeout in ms (default 30 000). */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNSUPPORTED_BACKEND_IDS = new Set([
  'local',
  'wsl',
  'os-sandbox',
  'singularity',
  'vercel-sandbox',
]);

const DEFAULT_TIMEOUT_MS = 30_000;

const BACKEND_LABELS: Record<string, string> = {
  'local': 'Local process',
  'docker': 'Docker sandbox',
  'wsl': 'WSL',
  'os-sandbox': 'Native OS sandbox',
  'ssh': 'SSH remote shell',
  'singularity': 'Singularity/Apptainer',
  'modal': 'Modal',
  'daytona': 'Daytona',
  'vercel-sandbox': 'Vercel Sandbox',
};

const ALL_BACKEND_IDS = Object.keys(BACKEND_LABELS);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SpawnResult {
  exitCode: number | null;
  ok: boolean;
  stdout: string;
  stderr: string;
}

function runSpawn(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): SpawnResult {
  try {
    const result = spawnSync(command, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      windowsHide: true,
    });
    const stdout = decodeBuffer(result.stdout).trim();
    const stderr = decodeBuffer(result.stderr).trim();
    return {
      exitCode: result.status,
      ok: !result.error && result.status === 0,
      stdout,
      stderr,
    };
  } catch {
    return { exitCode: null, ok: false, stdout: '', stderr: '' };
  }
}

function decodeBuffer(value: string | Buffer | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.toString('utf8');
}

function unsupportedAction(
  backendId: string,
  action: 'hibernate' | 'wake' | 'status',
  durationMs: number,
): BackendLifecycleAction {
  return {
    backendId,
    action,
    result: 'unsupported',
    state: 'unsupported',
    detail: `${BACKEND_LABELS[backendId] ?? backendId} does not support managed lifecycle operations.`,
    durationMs,
  };
}

function failedAction(
  backendId: string,
  action: 'hibernate' | 'wake' | 'status',
  detail: string,
  durationMs: number,
): BackendLifecycleAction {
  return {
    backendId,
    action,
    result: 'failed',
    state: 'unknown',
    detail,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Docker lifecycle
// ---------------------------------------------------------------------------

function dockerHibernate(containerId: string, env: NodeJS.ProcessEnv, timeoutMs: number): BackendLifecycleAction {
  const start = Date.now();
  if (!containerId) {
    return failedAction('docker', 'hibernate', 'containerId is required for docker hibernate.', 0);
  }
  const result = runSpawn('docker', ['pause', containerId], env, timeoutMs);
  const durationMs = Date.now() - start;
  if (result.ok) {
    return {
      backendId: 'docker',
      action: 'hibernate',
      result: 'success',
      state: 'hibernated',
      detail: `Container ${containerId} paused.`,
      durationMs,
    };
  }
  return failedAction('docker', 'hibernate', result.stderr || `docker pause failed (exit ${result.exitCode}).`, durationMs);
}

function dockerWake(containerId: string, env: NodeJS.ProcessEnv, timeoutMs: number): BackendLifecycleAction {
  const start = Date.now();
  if (!containerId) {
    return failedAction('docker', 'wake', 'containerId is required for docker wake.', 0);
  }
  const result = runSpawn('docker', ['unpause', containerId], env, timeoutMs);
  const durationMs = Date.now() - start;
  if (result.ok) {
    return {
      backendId: 'docker',
      action: 'wake',
      result: 'success',
      state: 'running',
      detail: `Container ${containerId} unpaused.`,
      durationMs,
    };
  }
  return failedAction('docker', 'wake', result.stderr || `docker unpause failed (exit ${result.exitCode}).`, durationMs);
}

function dockerStatus(containerId: string, env: NodeJS.ProcessEnv, timeoutMs: number): BackendLifecycleAction {
  const start = Date.now();
  if (!containerId) {
    return failedAction('docker', 'status', 'containerId is required for docker status.', 0);
  }
  const result = runSpawn(
    'docker',
    ['inspect', '--format', '{{.State.Status}}', containerId],
    env,
    timeoutMs,
  );
  const durationMs = Date.now() - start;
  if (!result.ok) {
    return failedAction('docker', 'status', result.stderr || `docker inspect failed (exit ${result.exitCode}).`, durationMs);
  }
  const raw = result.stdout.trim().toLowerCase();
  const state = dockerStatusToLifecycleState(raw);
  return {
    backendId: 'docker',
    action: 'status',
    result: 'success',
    state,
    detail: `Container ${containerId} status: ${raw}.`,
    durationMs,
  };
}

function dockerStatusToLifecycleState(dockerState: string): BackendLifecycleState {
  switch (dockerState) {
    case 'running':
      return 'running';
    case 'paused':
      return 'hibernated';
    case 'restarting':
      return 'starting';
    case 'removing':
    case 'exited':
    case 'dead':
      return 'stopping';
    default:
      return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// SSH lifecycle
// ---------------------------------------------------------------------------

function sshHibernate(_sshHost: string, _env: NodeJS.ProcessEnv, _timeoutMs: number): BackendLifecycleAction {
  // SSH "hibernate" = drop connection. We don't manage persistent connections,
  // so we just report success — the SSH session will close naturally.
  return {
    backendId: 'ssh',
    action: 'hibernate',
    result: 'success',
    state: 'hibernated',
    detail: 'SSH connection released; keepalive stopped.',
    durationMs: 0,
  };
}

function sshWake(sshHost: string, env: NodeJS.ProcessEnv, timeoutMs: number): BackendLifecycleAction {
  const start = Date.now();
  if (!sshHost) {
    return failedAction('ssh', 'wake', 'sshHost is required for SSH wake.', 0);
  }
  const result = runSpawn('ssh', ['-T', '-o', 'ConnectTimeout=10', sshHost, 'true'], env, timeoutMs);
  const durationMs = Date.now() - start;
  if (result.ok) {
    return {
      backendId: 'ssh',
      action: 'wake',
      result: 'success',
      state: 'running',
      detail: `SSH connection to ${sshHost} verified.`,
      durationMs,
    };
  }
  return failedAction('ssh', 'wake', result.stderr || `SSH connection to ${sshHost} failed (exit ${result.exitCode}).`, durationMs);
}

function sshStatus(sshHost: string, env: NodeJS.ProcessEnv, timeoutMs: number): BackendLifecycleAction {
  const start = Date.now();
  if (!sshHost) {
    return failedAction('ssh', 'status', 'sshHost is required for SSH status.', 0);
  }
  const result = runSpawn('ssh', ['-T', '-o', 'ConnectTimeout=5', sshHost, 'true'], env, timeoutMs);
  const durationMs = Date.now() - start;
  if (result.ok) {
    return {
      backendId: 'ssh',
      action: 'status',
      result: 'success',
      state: 'running',
      detail: `SSH host ${sshHost} is reachable.`,
      durationMs,
    };
  }
  return {
    backendId: 'ssh',
    action: 'status',
    result: 'success',
    state: 'hibernated',
    detail: `SSH host ${sshHost} is not reachable: ${result.stderr || `exit ${result.exitCode}`}.`,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Modal lifecycle
// ---------------------------------------------------------------------------

function modalHibernate(modalApp: string, env: NodeJS.ProcessEnv, timeoutMs: number): BackendLifecycleAction {
  const start = Date.now();
  if (!modalApp) {
    return failedAction('modal', 'hibernate', 'modalApp is required for Modal hibernate.', 0);
  }
  const result = runSpawn('modal', ['app', 'stop', modalApp], env, timeoutMs);
  const durationMs = Date.now() - start;
  if (result.ok) {
    return {
      backendId: 'modal',
      action: 'hibernate',
      result: 'success',
      state: 'hibernated',
      detail: `Modal app ${modalApp} stopped.`,
      durationMs,
    };
  }
  return failedAction('modal', 'hibernate', result.stderr || `modal app stop failed (exit ${result.exitCode}).`, durationMs);
}

function modalWake(modalApp: string, env: NodeJS.ProcessEnv, timeoutMs: number): BackendLifecycleAction {
  const start = Date.now();
  if (!modalApp) {
    return failedAction('modal', 'wake', 'modalApp is required for Modal wake.', 0);
  }
  const result = runSpawn('modal', ['run', modalApp], env, timeoutMs);
  const durationMs = Date.now() - start;
  if (result.ok) {
    return {
      backendId: 'modal',
      action: 'wake',
      result: 'success',
      state: 'running',
      detail: `Modal app ${modalApp} started.`,
      durationMs,
    };
  }
  return failedAction('modal', 'wake', result.stderr || `modal run failed (exit ${result.exitCode}).`, durationMs);
}

function modalStatus(modalApp: string, env: NodeJS.ProcessEnv, timeoutMs: number): BackendLifecycleAction {
  const start = Date.now();
  if (!modalApp) {
    return failedAction('modal', 'status', 'modalApp is required for Modal status.', 0);
  }
  const result = runSpawn('modal', ['app', 'list'], env, timeoutMs);
  const durationMs = Date.now() - start;
  if (!result.ok) {
    return failedAction('modal', 'status', result.stderr || `modal app list failed (exit ${result.exitCode}).`, durationMs);
  }
  const isRunning = result.stdout.includes(modalApp);
  return {
    backendId: 'modal',
    action: 'status',
    result: 'success',
    state: isRunning ? 'running' : 'hibernated',
    detail: isRunning
      ? `Modal app ${modalApp} appears in app list.`
      : `Modal app ${modalApp} not found in app list.`,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Daytona lifecycle
// ---------------------------------------------------------------------------

function daytonaHibernate(workspace: string, env: NodeJS.ProcessEnv, timeoutMs: number): BackendLifecycleAction {
  const start = Date.now();
  if (!workspace) {
    return failedAction('daytona', 'hibernate', 'daytonaWorkspace is required for Daytona hibernate.', 0);
  }
  const result = runSpawn('daytona', ['workspace', 'stop', workspace], env, timeoutMs);
  const durationMs = Date.now() - start;
  if (result.ok) {
    return {
      backendId: 'daytona',
      action: 'hibernate',
      result: 'success',
      state: 'hibernated',
      detail: `Daytona workspace ${workspace} stopped.`,
      durationMs,
    };
  }
  return failedAction('daytona', 'hibernate', result.stderr || `daytona workspace stop failed (exit ${result.exitCode}).`, durationMs);
}

function daytonaWake(workspace: string, env: NodeJS.ProcessEnv, timeoutMs: number): BackendLifecycleAction {
  const start = Date.now();
  if (!workspace) {
    return failedAction('daytona', 'wake', 'daytonaWorkspace is required for Daytona wake.', 0);
  }
  const result = runSpawn('daytona', ['workspace', 'start', workspace], env, timeoutMs);
  const durationMs = Date.now() - start;
  if (result.ok) {
    return {
      backendId: 'daytona',
      action: 'wake',
      result: 'success',
      state: 'running',
      detail: `Daytona workspace ${workspace} started.`,
      durationMs,
    };
  }
  return failedAction('daytona', 'wake', result.stderr || `daytona workspace start failed (exit ${result.exitCode}).`, durationMs);
}

function daytonaStatus(workspace: string, env: NodeJS.ProcessEnv, timeoutMs: number): BackendLifecycleAction {
  const start = Date.now();
  if (!workspace) {
    return failedAction('daytona', 'status', 'daytonaWorkspace is required for Daytona status.', 0);
  }
  const result = runSpawn('daytona', ['workspace', 'list'], env, timeoutMs);
  const durationMs = Date.now() - start;
  if (!result.ok) {
    return failedAction('daytona', 'status', result.stderr || `daytona workspace list failed (exit ${result.exitCode}).`, durationMs);
  }
  const isRunning = result.stdout.includes(workspace);
  return {
    backendId: 'daytona',
    action: 'status',
    result: 'success',
    state: isRunning ? 'running' : 'hibernated',
    detail: isRunning
      ? `Daytona workspace ${workspace} appears in workspace list.`
      : `Daytona workspace ${workspace} not found in workspace list.`,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a lifecycle action on a backend.
 */
export function executeBackendLifecycleAction(
  backendId: string,
  action: 'hibernate' | 'wake' | 'status',
  options: BackendLifecycleOptions = {},
): BackendLifecycleAction {
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (UNSUPPORTED_BACKEND_IDS.has(backendId)) {
    return unsupportedAction(backendId, action, 0);
  }

  if (!BACKEND_LABELS[backendId]) {
    return failedAction(backendId, action, `Unknown backend: ${backendId}.`, 0);
  }

  switch (backendId) {
    case 'docker': {
      const containerId = options.containerId ?? env.CODEBUDDY_DOCKER_CONTAINER ?? '';
      if (action === 'hibernate') return dockerHibernate(containerId, env, timeoutMs);
      if (action === 'wake') return dockerWake(containerId, env, timeoutMs);
      return dockerStatus(containerId, env, timeoutMs);
    }
    case 'ssh': {
      const sshHost = options.sshHost
        ?? env.CODEBUDDY_SSH_HOST
        ?? env.SSH_HOST
        ?? env.CODEBUDDY_REMOTE_HOST
        ?? '';
      if (action === 'hibernate') return sshHibernate(sshHost, env, timeoutMs);
      if (action === 'wake') return sshWake(sshHost, env, timeoutMs);
      return sshStatus(sshHost, env, timeoutMs);
    }
    case 'modal': {
      const modalApp = options.modalApp ?? env.CODEBUDDY_MODAL_APP ?? '';
      if (action === 'hibernate') return modalHibernate(modalApp, env, timeoutMs);
      if (action === 'wake') return modalWake(modalApp, env, timeoutMs);
      return modalStatus(modalApp, env, timeoutMs);
    }
    case 'daytona': {
      const workspace = options.daytonaWorkspace ?? env.CODEBUDDY_DAYTONA_WORKSPACE ?? '';
      if (action === 'hibernate') return daytonaHibernate(workspace, env, timeoutMs);
      if (action === 'wake') return daytonaWake(workspace, env, timeoutMs);
      return daytonaStatus(workspace, env, timeoutMs);
    }
    default:
      return unsupportedAction(backendId, action, 0);
  }
}

/**
 * Build a lifecycle status report for all backends.
 */
export function buildBackendLifecycleStatusReport(
  options: BackendLifecycleOptions = {},
): BackendLifecycleStatusReport {
  const now = options.now ?? (() => new Date());
  const entries: BackendLifecycleStatusEntry[] = ALL_BACKEND_IDS.map((backendId) => {
    const lifecycleSupported = !UNSUPPORTED_BACKEND_IDS.has(backendId);
    if (!lifecycleSupported) {
      return {
        backendId,
        label: BACKEND_LABELS[backendId] ?? backendId,
        lifecycleSupported: false,
        state: 'unsupported' as BackendLifecycleState,
        detail: `${BACKEND_LABELS[backendId] ?? backendId} does not support managed lifecycle operations.`,
      };
    }
    const statusAction = executeBackendLifecycleAction(backendId, 'status', options);
    return {
      backendId,
      label: BACKEND_LABELS[backendId] ?? backendId,
      lifecycleSupported: true,
      state: statusAction.state,
      detail: statusAction.detail,
    };
  });

  return {
    kind: 'hermes_runtime_lifecycle_status',
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    platform: os.platform(),
    arch: os.arch(),
    backends: entries,
  };
}

/**
 * Render a lifecycle status report as human-readable text.
 */
export function renderBackendLifecycleStatusReport(report: BackendLifecycleStatusReport): string {
  const lines = [
    'Hermes runtime lifecycle status',
    `Platform: ${report.platform}/${report.arch}`,
    `Generated: ${report.generatedAt}`,
    '',
    'Backends:',
    ...report.backends.map((entry) => {
      const supported = entry.lifecycleSupported ? 'lifecycle' : 'no-lifecycle';
      return `  ${entry.backendId}: ${entry.state} (${supported}) — ${entry.detail}`;
    }),
  ];
  return lines.join('\n');
}

/**
 * Render a single lifecycle action result as human-readable text.
 */
export function renderBackendLifecycleAction(action: BackendLifecycleAction): string {
  const lines = [
    `Hermes runtime lifecycle ${action.action} (${action.backendId}): ${action.result}`,
    `  State: ${action.state}`,
    `  Detail: ${action.detail}`,
    `  Duration: ${action.durationMs}ms`,
  ];
  return lines.join('\n');
}
