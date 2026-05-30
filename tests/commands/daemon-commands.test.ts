import { Command } from 'commander';
import {
  buildDaemonStatusReport,
  registerDaemonCommands,
} from '../../src/commands/cli/daemon-commands';

const mockManager = {
  status: jest.fn(),
};

jest.mock('../../src/daemon/index.js', () => ({
  getDaemonManager: jest.fn(() => mockManager),
}));

describe('daemon commands', () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  function createProgram(): Command {
    const program = new Command();
    program.exitOverride();
    program.configureOutput({
      writeOut: () => {},
      writeErr: () => {},
    });
    registerDaemonCommands(program);
    return program;
  }

  it('builds a machine-readable daemon status report', () => {
    const report = buildDaemonStatusReport({
      running: true,
      pid: 1234,
      uptime: 1250,
      startedAt: new Date('2026-05-30T10:00:00.000Z'),
      restartCount: 2,
      services: [
        {
          name: 'server',
          running: true,
          startedAt: new Date('2026-05-30T10:00:01.000Z'),
        },
        {
          name: 'scheduler',
          running: false,
          error: 'boom',
        },
      ],
    }, '2026-05-30T10:01:00.000Z');

    expect(report).toEqual({
      kind: 'codebuddy_daemon_status',
      schemaVersion: 1,
      generatedAt: '2026-05-30T10:01:00.000Z',
      status: {
        running: true,
        pid: 1234,
        uptimeMs: 1250,
        uptimeSeconds: 1,
        startedAt: '2026-05-30T10:00:00.000Z',
        restartCount: 2,
        services: [
          {
            name: 'server',
            running: true,
            startedAt: '2026-05-30T10:00:01.000Z',
            error: null,
          },
          {
            name: 'scheduler',
            running: false,
            startedAt: null,
            error: 'boom',
          },
        ],
      },
      summary: {
        serviceCount: 2,
        runningServiceCount: 1,
        stoppedServiceCount: 1,
      },
      recommendations: [
        'One or more daemon services are stopped; inspect daemon logs for service-level errors.',
      ],
    });
  });

  it('prints JSON for daemon status when --json is provided', async () => {
    mockManager.status.mockResolvedValue({
      running: false,
      services: [],
      restartCount: 0,
    });

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'daemon', 'status', '--json']);

    const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0]);
    expect(output.kind).toBe('codebuddy_daemon_status');
    expect(output.schemaVersion).toBe(1);
    expect(output.status.running).toBe(false);
    expect(output.status.pid).toBeNull();
    expect(output.status.uptimeMs).toBeNull();
    expect(output.summary.serviceCount).toBe(0);
    expect(output.recommendations).toContain(
      'Start the daemon with `buddy daemon start --detach` before relying on scheduled jobs or background services.',
    );
  });
});
