/**
 * Phase T5 — Tests for src/agent/facades/infrastructure-facade.ts.
 *
 * Fifth (and final) of the CRITIQUE-priority test gaps from the
 * audit-driven plan (after T1-T4). InfrastructureFacade owns the
 * five infrastructure subsystems: MCP servers, sandbox, lifecycle
 * hooks, prompt cache, plugin marketplace — plus the ICM memory
 * bridge instantiated in the constructor.
 *
 * The facade is mostly a passthrough surface. The one piece of
 * actual logic is `initializeMCP()`, a fire-and-forget async with
 * two conditional branches (config.servers.length > 0,
 * integrations.icm_enabled). All errors must be swallowed (warn
 * logged) so the boot path never crashes on infra issues.
 *
 * Test scope:
 * - Constructor wires the 5 deps + creates an ICMBridge instance.
 * - All getter passthroughs return the wired dependency.
 * - MCP/sandbox/hooks/prompt-cache delegations call the underlying
 *   method exactly once with the right args.
 * - initializeMCP fire-and-forget paths:
 *   * config.servers empty → does NOT call initializeMCPServers
 *   * config.servers non-empty → calls initializeMCPServers
 *   * icm_enabled true + mcpClient → calls icmBridge.initialize
 *   * icm_enabled false → does NOT call icmBridge.initialize
 *   * thrown error in inner async → swallowed (warn logged)
 *   * thrown error in IIFE outer wrapper → swallowed
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---- mocks ------------------------------------------------------------

const mcpMocks = vi.hoisted(() => ({
  loadMCPConfigMock: vi.fn(() => ({ servers: [] as unknown[] })),
  initializeMCPServersMock: vi.fn(async () => undefined),
}));

vi.mock('../../../src/mcp/config.js', () => ({
  loadMCPConfig: mcpMocks.loadMCPConfigMock,
}));

vi.mock('../../../src/codebuddy/tools.js', () => ({
  initializeMCPServers: mcpMocks.initializeMCPServersMock,
}));

const configMocks = vi.hoisted(() => ({
  getConfigMock: vi.fn(() => ({ integrations: { icm_enabled: false } })),
}));

vi.mock('../../../src/config/toml-config.js', () => ({
  getConfigManager: () => ({ getConfig: configMocks.getConfigMock }),
}));

const icmMocks = vi.hoisted(() => {
  const initialize = vi.fn(async () => undefined);
  return {
    initialize,
    ICMBridgeStub: class {
      initialize = initialize;
    },
  };
});

vi.mock('../../../src/memory/icm-bridge.js', () => ({
  ICMBridge: icmMocks.ICMBridgeStub,
}));

// ---- imports under test ----------------------------------------------

import {
  InfrastructureFacade,
  type InfrastructureFacadeDeps,
} from '../../../src/agent/facades/infrastructure-facade.js';

// ---- helpers ---------------------------------------------------------

function buildDeps() {
  const connectAll = vi.fn(async () => undefined);
  const formatStatusMcp = vi.fn(() => 'mcp-status');
  const getAllTools = vi.fn(async () => new Map([['srvA', [{ n: 1 }]]]));
  const mcpClient = {
    connectAll,
    formatStatus: formatStatusMcp,
    getAllTools,
  } as unknown as InfrastructureFacadeDeps['mcpClient'];

  const formatStatusSandbox = vi.fn(() => 'sandbox-status');
  const validateCommand = vi.fn((cmd: string) => ({
    valid: !cmd.includes('rm -rf /'),
    reason: cmd.includes('rm -rf /') ? 'destructive' : undefined,
  }));
  const sandboxManager = {
    formatStatus: formatStatusSandbox,
    validateCommand,
  } as unknown as InfrastructureFacadeDeps['sandboxManager'];

  const formatStatusHooks = vi.fn(() => 'hooks-status');
  const hooksManager = {
    formatStatus: formatStatusHooks,
  } as unknown as InfrastructureFacadeDeps['hooksManager'];

  const getStats = vi.fn(() => ({
    hits: 5,
    misses: 2,
    hitRate: 0.71,
    totalTokensSaved: 1000,
    estimatedCostSaved: 0.05,
    entries: 7,
  }));
  const formatStatsCache = vi.fn(() => 'cache-stats-formatted');
  const promptCacheManager = {
    getStats,
    formatStats: formatStatsCache,
  } as unknown as InfrastructureFacadeDeps['promptCacheManager'];

  const marketplace = { name: 'mock-marketplace' } as unknown as InfrastructureFacadeDeps['marketplace'];

  return {
    deps: { mcpClient, sandboxManager, hooksManager, promptCacheManager, marketplace },
    connectAll,
    formatStatusMcp,
    getAllTools,
    formatStatusSandbox,
    validateCommand,
    formatStatusHooks,
    getStats,
    formatStatsCache,
  };
}

// ---- tests -----------------------------------------------------------

describe('InfrastructureFacade — Phase T5', () => {
  beforeEach(() => {
    mcpMocks.loadMCPConfigMock.mockReset().mockReturnValue({ servers: [] });
    mcpMocks.initializeMCPServersMock.mockReset().mockResolvedValue(undefined);
    configMocks.getConfigMock
      .mockReset()
      .mockReturnValue({ integrations: { icm_enabled: false } });
    icmMocks.initialize.mockReset().mockResolvedValue(undefined);
  });

  describe('construction + dependency wiring', () => {
    it('wires all 5 deps and creates an ICMBridge', () => {
      const { deps } = buildDeps();
      const f = new InfrastructureFacade(deps);
      expect(f.getMCPClient()).toBe(deps.mcpClient);
      expect(f.getSandboxManager()).toBe(deps.sandboxManager);
      expect(f.getHooksManager()).toBe(deps.hooksManager);
      expect(f.getPromptCacheManager()).toBe(deps.promptCacheManager);
      expect(f.getMarketplace()).toBe(deps.marketplace);
      expect(f.getICMBridge()).toBeInstanceOf(icmMocks.ICMBridgeStub);
    });
  });

  describe('MCP passthroughs', () => {
    it('connectMCPServers delegates to mcpClient.connectAll', async () => {
      const { deps, connectAll } = buildDeps();
      const f = new InfrastructureFacade(deps);
      await f.connectMCPServers();
      expect(connectAll).toHaveBeenCalledOnce();
    });

    it('getMCPStatus delegates to mcpClient.formatStatus', () => {
      const { deps, formatStatusMcp } = buildDeps();
      const f = new InfrastructureFacade(deps);
      expect(f.getMCPStatus()).toBe('mcp-status');
      expect(formatStatusMcp).toHaveBeenCalledOnce();
    });

    it('getMCPTools delegates to mcpClient.getAllTools', async () => {
      const { deps, getAllTools } = buildDeps();
      const f = new InfrastructureFacade(deps);
      const tools = await f.getMCPTools();
      expect(getAllTools).toHaveBeenCalledOnce();
      expect(tools.get('srvA')).toEqual([{ n: 1 }]);
    });
  });

  describe('initializeMCP — fire-and-forget paths', () => {
    /** Helper: flush all pending microtasks so the IIFE finishes. */
    async function flushAsync(): Promise<void> {
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    }

    it('does NOT call initializeMCPServers when config.servers is empty', async () => {
      mcpMocks.loadMCPConfigMock.mockReturnValueOnce({ servers: [] });
      const { deps } = buildDeps();
      const f = new InfrastructureFacade(deps);
      f.initializeMCP();
      await flushAsync();
      expect(mcpMocks.initializeMCPServersMock).not.toHaveBeenCalled();
    });

    it('calls initializeMCPServers when config.servers is non-empty', async () => {
      mcpMocks.loadMCPConfigMock.mockReturnValueOnce({
        servers: [{ name: 'fileio' }, { name: 'shell' }],
      });
      const { deps } = buildDeps();
      const f = new InfrastructureFacade(deps);
      f.initializeMCP();
      await flushAsync();
      expect(mcpMocks.initializeMCPServersMock).toHaveBeenCalledOnce();
    });

    it('calls icmBridge.initialize when icm_enabled is true and mcpClient exists', async () => {
      configMocks.getConfigMock.mockReturnValueOnce({ integrations: { icm_enabled: true } });
      const { deps } = buildDeps();
      const f = new InfrastructureFacade(deps);
      f.initializeMCP();
      await flushAsync();
      expect(icmMocks.initialize).toHaveBeenCalledOnce();
      // Wired with mcpClient as the MCPToolCaller
      expect(icmMocks.initialize.mock.calls[0][0]).toBe(deps.mcpClient);
    });

    it('does NOT call icmBridge.initialize when icm_enabled is false', async () => {
      configMocks.getConfigMock.mockReturnValueOnce({ integrations: { icm_enabled: false } });
      const { deps } = buildDeps();
      const f = new InfrastructureFacade(deps);
      f.initializeMCP();
      await flushAsync();
      expect(icmMocks.initialize).not.toHaveBeenCalled();
    });

    it('does NOT call icmBridge.initialize when integrations is undefined', async () => {
      configMocks.getConfigMock.mockReturnValueOnce({} as ReturnType<typeof configMocks.getConfigMock>);
      const { deps } = buildDeps();
      const f = new InfrastructureFacade(deps);
      f.initializeMCP();
      await flushAsync();
      expect(icmMocks.initialize).not.toHaveBeenCalled();
    });

    it('swallows errors thrown in the inner async block (warn logged, no throw)', async () => {
      mcpMocks.loadMCPConfigMock.mockImplementationOnce(() => {
        throw new Error('config disk error');
      });
      const { deps } = buildDeps();
      const f = new InfrastructureFacade(deps);
      // Must not throw despite loadMCPConfig blowing up
      expect(() => f.initializeMCP()).not.toThrow();
      await flushAsync();
    });

    it('swallows errors from initializeMCPServers itself (async path)', async () => {
      mcpMocks.loadMCPConfigMock.mockReturnValueOnce({ servers: [{ name: 's' }] });
      mcpMocks.initializeMCPServersMock.mockRejectedValueOnce(new Error('server boom'));
      const { deps } = buildDeps();
      const f = new InfrastructureFacade(deps);
      expect(() => f.initializeMCP()).not.toThrow();
      await flushAsync();
    });

    it('swallows errors from icmBridge.initialize (async path)', async () => {
      configMocks.getConfigMock.mockReturnValueOnce({ integrations: { icm_enabled: true } });
      icmMocks.initialize.mockRejectedValueOnce(new Error('icm init failed'));
      const { deps } = buildDeps();
      const f = new InfrastructureFacade(deps);
      expect(() => f.initializeMCP()).not.toThrow();
      await flushAsync();
    });
  });

  describe('sandbox passthroughs', () => {
    it('getSandboxStatus delegates', () => {
      const { deps, formatStatusSandbox } = buildDeps();
      const f = new InfrastructureFacade(deps);
      expect(f.getSandboxStatus()).toBe('sandbox-status');
      expect(formatStatusSandbox).toHaveBeenCalledOnce();
    });

    it('validateCommand passes the command and returns the validation', () => {
      const { deps, validateCommand } = buildDeps();
      const f = new InfrastructureFacade(deps);
      const ok = f.validateCommand('ls');
      expect(ok.valid).toBe(true);
      expect(validateCommand).toHaveBeenCalledWith('ls');

      const bad = f.validateCommand('rm -rf /');
      expect(bad.valid).toBe(false);
      expect(bad.reason).toBe('destructive');
    });
  });

  describe('hooks passthroughs', () => {
    it('getHooksStatus delegates', () => {
      const { deps, formatStatusHooks } = buildDeps();
      const f = new InfrastructureFacade(deps);
      expect(f.getHooksStatus()).toBe('hooks-status');
      expect(formatStatusHooks).toHaveBeenCalledOnce();
    });
  });

  describe('prompt cache passthroughs', () => {
    it('getPromptCacheStats returns the underlying stats', () => {
      const { deps, getStats } = buildDeps();
      const f = new InfrastructureFacade(deps);
      const stats = f.getPromptCacheStats();
      expect(stats.hits).toBe(5);
      expect(stats.hitRate).toBe(0.71);
      expect(getStats).toHaveBeenCalledOnce();
    });

    it('formatPromptCacheStats delegates', () => {
      const { deps, formatStatsCache } = buildDeps();
      const f = new InfrastructureFacade(deps);
      expect(f.formatPromptCacheStats()).toBe('cache-stats-formatted');
      expect(formatStatsCache).toHaveBeenCalledOnce();
    });
  });
});
