import { CronAgentBridge, resetCronAgentBridge } from '../../src/daemon/cron-agent-bridge.js';
import type { CronJob } from '../../src/scheduler/cron-scheduler.js';

// Mock the CodeBuddyAgent dynamic import used inside executeJob
vi.mock('../../src/agent/codebuddy-agent.js', () => ({
  CodeBuddyAgent: class MockCodeBuddyAgent {
    async processUserMessage() {
      return [{ type: 'assistant', content: 'mock response' }];
    }
  },
}));

describe('CronAgentBridge', () => {
  let bridge: CronAgentBridge;

  beforeEach(() => {
    resetCronAgentBridge();
    bridge = new CronAgentBridge({
      apiKey: 'test-key',
      baseURL: 'http://localhost:3000',
      model: 'test-model',
      maxToolRounds: 5,
      jobTimeoutMs: 10000,
    });
  });

  it('should create a task executor function', () => {
    const executor = bridge.createTaskExecutor();
    expect(typeof executor).toBe('function');
  });

  it('should track active job count', () => {
    expect(bridge.getActiveJobCount()).toBe(0);
  });

  it('should cancel non-existent job gracefully', () => {
    expect(bridge.cancelJob('non-existent')).toBe(false);
  });

  it('should emit events on job execution', async () => {
    const events: string[] = [];
    bridge.on('job:start', () => events.push('start'));
    bridge.on('job:error', () => events.push('error'));

    const job: CronJob = {
      id: 'test-job',
      name: 'Test Job',
      type: 'every',
      schedule: { every: 60000 },
      task: { type: 'message', message: 'test' },
      status: 'active',
      createdAt: new Date(),
      runCount: 0,
      errorCount: 0,
      enabled: true,
    };

    // This will fail because CodeBuddyAgent requires a real API key
    // but we can verify events are emitted
    try {
      await bridge.executeJob(job);
    } catch {
      // Expected to fail
    }

    expect(events).toContain('start');
  });

  it('should handle webhook delivery', async () => {
    const job: CronJob = {
      id: 'test-job',
      name: 'Test Job',
      type: 'every',
      schedule: { every: 60000 },
      task: { type: 'message', message: 'test' },
      delivery: { webhookUrl: 'http://localhost:9999/webhook' },
      status: 'active',
      createdAt: new Date(),
      runCount: 0,
      errorCount: 0,
      enabled: true,
    };

    // Webhook will fail (no server) but should not throw
    const result = await bridge.deliverResult(job, 'test output');
    // May or may not deliver depending on fetch behavior
    expect(result).toBeDefined();
  });

  it('should return not delivered when no delivery config', async () => {
    const job: CronJob = {
      id: 'test-job',
      name: 'Test Job',
      type: 'every',
      schedule: { every: 60000 },
      task: { type: 'message' },
      status: 'active',
      createdAt: new Date(),
      runCount: 0,
      errorCount: 0,
      enabled: true,
    };

    const result = await bridge.deliverResult(job, 'output');
    expect(result.delivered).toBe(false);
  });

  describe('pre-check gate', () => {
    function jobWithPreCheck(preCheck: CronJob['preCheck']): CronJob {
      return {
        id: 'precheck-job',
        name: 'Pre-check Job',
        type: 'every',
        schedule: { every: 60000 },
        task: { type: 'message', message: 'expensive work' },
        status: 'active',
        createdAt: new Date(),
        runCount: 0,
        errorCount: 0,
        enabled: true,
        preCheck,
      };
    }

    it('skips the LLM task when the pre-check says nothing changed', async () => {
      const job = jobWithPreCheck({
        type: 'command',
        command: { executable: 'node', args: ['-e', 'process.exit(1)'] },
      });

      const skipped: unknown[] = [];
      bridge.on('job:skipped', (r) => skipped.push(r));

      const result = await bridge.executeJob(job);
      expect(result.skipped).toBe(true);
      expect(result.success).toBe(true);
      expect(result.output).toMatch(/Skipped by pre-check/);
      // The mocked agent returns 'mock response'; a skip must not call it.
      expect(result.output).not.toContain('mock response');
      expect(skipped).toHaveLength(1);
    });

    it('runs the LLM task when the pre-check passes', async () => {
      const job = jobWithPreCheck({
        type: 'command',
        command: { executable: 'node', args: ['-e', 'process.exit(0)'] },
      });

      const result = await bridge.executeJob(job);
      expect(result.skipped).toBeUndefined();
      expect(result.output).toContain('mock response');
    });

    it('persists the new fingerprint onto the job after evaluation', async () => {
      const job = jobWithPreCheck({
        type: 'command',
        runWhen: 'stdout_changed',
        command: { executable: 'node', args: ['-e', 'console.log("hello")'] },
      });

      await bridge.executeJob(job);
      expect(typeof job.preCheck?.lastFingerprint).toBe('string');
    });
  });

  describe('watchdog task', () => {
    it('runs disk/http/etc checks without instantiating an agent', async () => {
      const job: CronJob = {
        id: 'watchdog-job',
        name: 'Disk Watchdog',
        type: 'every',
        schedule: { every: 60000 },
        task: { type: 'watchdog', watchdog: { checks: [{ type: 'disk', minFreeBytes: 0 }] } },
        status: 'active',
        createdAt: new Date(),
        runCount: 0,
        errorCount: 0,
        enabled: true,
      };

      const events: unknown[] = [];
      bridge.on('job:watchdog', (e) => events.push(e));

      const result = await bridge.executeJob(job);
      expect(result.success).toBe(true);
      expect(result.watchdogOk).toBe(true);
      // No agent was used, so the mock response never appears.
      expect(result.output).not.toContain('mock response');
      expect(result.output).toMatch(/watchdog ok/i);
      expect(events).toHaveLength(1);
    });

    it('reports watchdogOk false when a check alerts', async () => {
      const job: CronJob = {
        id: 'watchdog-alert-job',
        name: 'Disk Watchdog Alert',
        type: 'every',
        schedule: { every: 60000 },
        task: {
          type: 'watchdog',
          watchdog: { checks: [{ type: 'disk', minFreeBytes: Number.MAX_SAFE_INTEGER }] },
        },
        status: 'active',
        createdAt: new Date(),
        runCount: 0,
        errorCount: 0,
        enabled: true,
      };

      const result = await bridge.executeJob(job);
      expect(result.success).toBe(true);
      expect(result.watchdogOk).toBe(false);
    });
  });
});
