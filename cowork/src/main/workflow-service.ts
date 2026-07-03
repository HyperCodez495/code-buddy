import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { log, logError } from './utils/logger';

let workflowProcess: ChildProcess | null = null;

// Ring buffer of boot log lines — surfaced to the renderer (WorkflowProPanel)
// so "Start Server" streams its progress instead of showing a blind spinner.
const BOOT_LOG_CAP = 200;
let bootLog: string[] = [];

function pushBootLog(chunk: string): void {
  for (const line of chunk.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (trimmed) bootLog.push(trimmed);
  }
  if (bootLog.length > BOOT_LOG_CAP) {
    bootLog = bootLog.slice(-BOOT_LOG_CAP);
  }
}

export const WorkflowService = {
  async start() {
    if (workflowProcess) return { success: true };

    // Path to the workflow project
    const workflowDir = join(process.env.HOME || process.env.USERPROFILE || '', 'workflow');
    bootLog = [];

    try {
      log('[WorkflowService] Starting external workflow builder...');
      pushBootLog('Starting WorkflowBuilder (npm run dev)…');
      // Start via npm run dev
      workflowProcess = spawn('npm', ['run', 'dev'], {
        cwd: workflowDir,
        shell: true,
      });

      workflowProcess.stdout?.on('data', (data) => {
        pushBootLog(data.toString());
      });

      workflowProcess.stderr?.on('data', (data) => {
        const msg = data.toString();
        pushBootLog(msg);
        if (msg.includes('error')) logError(`[WorkflowService] stderr: ${msg}`);
      });

      workflowProcess.on('close', (code) => {
        log(`[WorkflowService] Process exited with code ${code}`);
        pushBootLog(`Process exited with code ${code}`);
        workflowProcess = null;
      });

      return { success: true };
    } catch (err) {
      logError(`[WorkflowService] Failed to start: ${err}`);
      pushBootLog(`Failed to start: ${String(err)}`);
      return { success: false, error: String(err) };
    }
  },

  async stop() {
    if (workflowProcess) {
      workflowProcess.kill('SIGTERM');
      workflowProcess = null;
      log('[WorkflowService] Stopped');
      pushBootLog('Stopped');
    }
    return { success: true };
  },

  status() {
    return { running: workflowProcess !== null, port: 8080 };
  },

  /** Recent boot log lines (renderer streams these while the server starts). */
  logs(limit = 50): { lines: string[] } {
    return { lines: bootLog.slice(-limit) };
  },
};
