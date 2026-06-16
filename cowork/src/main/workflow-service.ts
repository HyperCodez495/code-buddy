import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { log, logError } from './utils/logger';

let workflowProcess: ChildProcess | null = null;

export const WorkflowService = {
  async start() {
    if (workflowProcess) return { success: true };
    
    // Path to the workflow project
    const workflowDir = join(process.env.HOME || process.env.USERPROFILE || '', 'workflow');
    
    try {
      log('[WorkflowService] Starting external workflow builder...');
      // Start via npm run dev
      workflowProcess = spawn('npm', ['run', 'dev'], {
        cwd: workflowDir,
        shell: true,
      });

      workflowProcess.stdout?.on('data', () => {
        // Just log internally, or could parse for "ready"
      });

      workflowProcess.stderr?.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('error')) logError(`[WorkflowService] stderr: ${msg}`);
      });

      workflowProcess.on('close', (code) => {
        log(`[WorkflowService] Process exited with code ${code}`);
        workflowProcess = null;
      });

      return { success: true };
    } catch (err) {
      logError(`[WorkflowService] Failed to start: ${err}`);
      return { success: false, error: String(err) };
    }
  },

  async stop() {
    if (workflowProcess) {
      workflowProcess.kill('SIGTERM');
      workflowProcess = null;
      log('[WorkflowService] Stopped');
    }
    return { success: true };
  },

  status() {
    return { running: workflowProcess !== null, port: 8080 };
  }
};
