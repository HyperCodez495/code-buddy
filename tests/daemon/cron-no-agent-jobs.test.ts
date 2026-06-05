import { CronAgentBridge, resetCronAgentBridge } from '../../src/daemon/cron-agent-bridge.js';
import type { CronJob } from '../../src/scheduler/cron-scheduler.js';

// The agent import must never be reached for script/skill jobs. If it is, the
// mock makes the failure loud rather than spinning up a real provider call.
vi.mock('../../src/agent/codebuddy-agent.js', () => ({
  CodeBuddyAgent: class MockCodeBuddyAgent {
    async processUserMessage() {
      throw new Error('agent should not be instantiated for no-agent jobs');
    }
  },
}));

const mockExecute = vi.fn();
const mockGet = vi.fn();
const mockLoad = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/skills/registry.js', () => ({
  getSkillRegistry: () => ({
    load: mockLoad,
    get: mockGet,
  }),
}));

vi.mock('../../src/skills/executor.js', () => ({
  getSkillExecutor: () => ({
    execute: mockExecute,
  }),
}));

function makeJob(task: CronJob['task']): CronJob {
  return {
    id: 'job-noagent',
    name: 'No-agent job',
    type: 'every',
    schedule: { every: 60000 },
    task,
    status: 'active',
    createdAt: new Date(),
    runCount: 0,
    errorCount: 0,
    enabled: true,
  };
}

describe('CronAgentBridge no-agent task types', () => {
  let bridge: CronAgentBridge;

  beforeEach(() => {
    resetCronAgentBridge();
    mockExecute.mockReset();
    mockGet.mockReset();
    mockLoad.mockClear();
    bridge = new CronAgentBridge({
      apiKey: 'test-key',
      maxToolRounds: 5,
      jobTimeoutMs: 10000,
    });
  });

  describe('script task', () => {
    it('runs an allowlisted command without an agent and reports success', async () => {
      const events: Array<Record<string, unknown>> = [];
      bridge.on('job:script', (e) => events.push(e));

      const job = makeJob({
        type: 'script',
        command: {
          executable: process.execPath,
          args: ['-e', 'process.stdout.write("script ran")'],
        },
      });

      const result = await bridge.executeJob(job);
      expect(result.success).toBe(true);
      expect(result.output).toContain('script ran');
      expect(events[0]?.exitCode).toBe(0);
    });

    it('fails the run when the script exits non-zero', async () => {
      const job = makeJob({
        type: 'script',
        command: {
          executable: process.execPath,
          args: ['-e', 'process.exit(2)'],
        },
      });

      await expect(bridge.executeJob(job)).rejects.toThrow(/exit 2/);
    });

    it('rejects a script with no executable', async () => {
      const job = makeJob({ type: 'script' });
      await expect(bridge.executeJob(job)).rejects.toThrow(/requires a command/);
    });
  });

  describe('skill task', () => {
    it('loads and executes a named skill via the registry + executor', async () => {
      const fakeSkill = { metadata: { name: 'cleanup' }, content: {} };
      mockGet.mockReturnValue(fakeSkill);
      mockExecute.mockResolvedValue({ success: true, output: 'skill guidance', duration: 1 });

      const events: Array<Record<string, unknown>> = [];
      bridge.on('job:skill', (e) => events.push(e));

      const job = makeJob({ type: 'skill', skill: 'cleanup', skillRequest: 'do the thing' });
      const result = await bridge.executeJob(job);

      expect(mockLoad).toHaveBeenCalled();
      expect(mockGet).toHaveBeenCalledWith('cleanup');
      expect(mockExecute).toHaveBeenCalledWith(
        fakeSkill,
        expect.objectContaining({ request: 'do the thing' }),
      );
      expect(result.success).toBe(true);
      expect(result.output).toBe('skill guidance');
      expect(events[0]?.skill).toBe('cleanup');
    });

    it('fails cleanly when the named skill does not exist', async () => {
      mockGet.mockReturnValue(undefined);
      const job = makeJob({ type: 'skill', skill: 'missing-skill' });
      await expect(bridge.executeJob(job)).rejects.toThrow(/Skill not found: missing-skill/);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('fails when the skill executor reports failure', async () => {
      mockGet.mockReturnValue({ metadata: { name: 'broken' }, content: {} });
      mockExecute.mockResolvedValue({ success: false, error: 'boom', duration: 1 });
      const job = makeJob({ type: 'skill', skill: 'broken' });
      await expect(bridge.executeJob(job)).rejects.toThrow(/Skill 'broken' failed: boom/);
    });

    it('rejects a skill task without a skill name', async () => {
      const job = makeJob({ type: 'skill' });
      await expect(bridge.executeJob(job)).rejects.toThrow(/requires a skill name/);
    });
  });
});
