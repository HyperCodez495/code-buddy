/**
 * Phase 2 — verify CodeBuddyEngineAdapter.setMcpServers diffs the
 * core MCPManager registry correctly: adds new servers, removes
 * missing ones, re-adds entries whose transport changed.
 *
 * The core MCPManager is mocked so we can assert add/remove calls
 * without spawning real MCP child processes.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockManager = {
  addServer: vi.fn(async () => undefined),
  removeServer: vi.fn(async () => undefined),
};

vi.mock('../../src/codebuddy/tools.js', () => ({
  getMCPManager: () => mockManager,
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import { CodeBuddyEngineAdapter } from '../../src/desktop/codebuddy-engine-adapter';

describe('CodeBuddyEngineAdapter.setMcpServers', () => {
  beforeEach(() => {
    mockManager.addServer.mockClear();
    mockManager.removeServer.mockClear();
  });

  function makeAdapter() {
    return new CodeBuddyEngineAdapter({ apiKey: 'k', model: 'm' });
  }

  it('adds enabled servers on first sync', async () => {
    const adapter = makeAdapter();
    await adapter.setMcpServers([
      {
        name: 'fs',
        transport: { type: 'stdio', command: 'mcp-fs' },
        enabled: true,
      },
    ]);
    expect(mockManager.addServer).toHaveBeenCalledTimes(1);
    expect(mockManager.removeServer).not.toHaveBeenCalled();
    expect(mockManager.addServer.mock.calls[0][0]).toMatchObject({
      name: 'fs',
      transport: { type: 'stdio', command: 'mcp-fs' },
      enabled: true,
    });
  });

  it('skips disabled servers', async () => {
    const adapter = makeAdapter();
    await adapter.setMcpServers([
      { name: 'a', transport: { type: 'stdio', command: 'a' }, enabled: false },
    ]);
    expect(mockManager.addServer).not.toHaveBeenCalled();
  });

  it('removes servers that disappear from the desired list', async () => {
    const adapter = makeAdapter();
    await adapter.setMcpServers([
      { name: 'a', transport: { type: 'stdio', command: 'a' }, enabled: true },
      { name: 'b', transport: { type: 'stdio', command: 'b' }, enabled: true },
    ]);
    expect(mockManager.addServer).toHaveBeenCalledTimes(2);

    await adapter.setMcpServers([
      { name: 'a', transport: { type: 'stdio', command: 'a' }, enabled: true },
    ]);
    expect(mockManager.removeServer).toHaveBeenCalledWith('b');
  });

  it('re-adds a server when its transport changes', async () => {
    const adapter = makeAdapter();
    await adapter.setMcpServers([
      { name: 'a', transport: { type: 'stdio', command: 'old' }, enabled: true },
    ]);
    mockManager.addServer.mockClear();
    mockManager.removeServer.mockClear();

    await adapter.setMcpServers([
      { name: 'a', transport: { type: 'stdio', command: 'new' }, enabled: true },
    ]);
    expect(mockManager.removeServer).toHaveBeenCalledWith('a');
    expect(mockManager.addServer).toHaveBeenCalledTimes(1);
  });

  it('does not re-add servers whose transport is unchanged', async () => {
    const adapter = makeAdapter();
    const cfg = {
      name: 'x',
      transport: { type: 'stdio' as const, command: 'x', args: ['--quiet'] },
      enabled: true,
    };
    await adapter.setMcpServers([cfg]);
    mockManager.addServer.mockClear();
    mockManager.removeServer.mockClear();

    await adapter.setMcpServers([cfg]);
    expect(mockManager.addServer).not.toHaveBeenCalled();
    expect(mockManager.removeServer).not.toHaveBeenCalled();
  });

  it('continues syncing other servers when one addServer fails', async () => {
    const adapter = makeAdapter();
    mockManager.addServer
      .mockImplementationOnce(async () => {
        throw new Error('boom');
      })
      .mockImplementationOnce(async () => undefined);
    await adapter.setMcpServers([
      { name: 'broken', transport: { type: 'stdio', command: 'fail' }, enabled: true },
      { name: 'ok', transport: { type: 'stdio', command: 'ok' }, enabled: true },
    ]);
    expect(mockManager.addServer).toHaveBeenCalledTimes(2);
  });
});
