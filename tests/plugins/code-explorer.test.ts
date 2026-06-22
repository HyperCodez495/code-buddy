import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { execSync, spawn } from 'child_process';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

// Mock fs (selective)
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import {
  CodeExplorerManager,
  getCodeExplorerManager,
  clearCodeExplorerManagerCache,
} from '../../src/plugins/code-explorer/CodeExplorerManager.js';
import { CodeExplorerMCPClient } from '../../src/plugins/code-explorer/CodeExplorerMCPClient.js';
import type {
  CodeExplorerStats,
  GNQueryResult,
  GNContextResult,
  GNImpactResult,
} from '../../src/plugins/code-explorer/index.js';

describe('CodeExplorerManager', () => {
  let manager: CodeExplorerManager;
  const testRepoPath = '/test/repo';

  beforeEach(() => {
    vi.clearAllMocks();
    clearCodeExplorerManagerCache();
    manager = new CodeExplorerManager(testRepoPath);
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('isInstalled', () => {
    it('should return true when gitnexus CLI is available', () => {
      (execSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        Buffer.from('1.0.0'),
      );

      expect(manager.isInstalled()).toBe(true);
      expect(execSync).toHaveBeenCalledWith('npx gitnexus --version', {
        stdio: 'pipe',
        timeout: 10_000,
        cwd: path.resolve(testRepoPath),
      });
    });

    it('should return false when gitnexus CLI is not available', () => {
      (execSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        () => {
          throw new Error('command not found');
        },
      );

      expect(manager.isInstalled()).toBe(false);
    });
  });

  describe('isRepoIndexed', () => {
    it('should return true when .codeexplorer directory exists', () => {
      (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        true,
      );

      expect(manager.isRepoIndexed()).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledWith(
        path.join(path.resolve(testRepoPath), '.codeexplorer'),
      );
    });

    it('should return false when .codeexplorer directory does not exist', () => {
      (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        false,
      );

      expect(manager.isRepoIndexed()).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return default stats when meta.json does not exist', () => {
      (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        false,
      );

      const stats = manager.getStats();
      expect(stats).toEqual({
        symbols: 0,
        relations: 0,
        processes: 0,
        clusters: 0,
        indexed: false,
        stale: false,
      });
    });

    it('should parse stats from meta.json when present', () => {
      (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        true,
      );
      (
        fs.readFileSync as unknown as ReturnType<typeof vi.fn>
      ).mockReturnValue(
        JSON.stringify({
          symbols: 150,
          relations: 300,
          processes: 5,
          clusters: 8,
          stale: false,
        }),
      );

      const stats = manager.getStats();
      expect(stats).toEqual({
        symbols: 150,
        relations: 300,
        processes: 5,
        clusters: 8,
        indexed: true,
        stale: false,
      });
    });

    it('should handle stale flag in meta.json', () => {
      (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        true,
      );
      (
        fs.readFileSync as unknown as ReturnType<typeof vi.fn>
      ).mockReturnValue(
        JSON.stringify({
          symbols: 50,
          relations: 100,
          processes: 2,
          clusters: 3,
          stale: true,
        }),
      );

      const stats = manager.getStats();
      expect(stats.stale).toBe(true);
      expect(stats.indexed).toBe(true);
    });

    it('should return defaults when meta.json is malformed', () => {
      (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        true,
      );
      (
        fs.readFileSync as unknown as ReturnType<typeof vi.fn>
      ).mockReturnValue('not valid json{{{');

      const stats = manager.getStats();
      expect(stats).toEqual({
        symbols: 0,
        relations: 0,
        processes: 0,
        clusters: 0,
        indexed: false,
        stale: false,
      });
    });

    it('should handle missing numeric fields gracefully', () => {
      (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        true,
      );
      (
        fs.readFileSync as unknown as ReturnType<typeof vi.fn>
      ).mockReturnValue(
        JSON.stringify({
          symbols: 'not a number',
          relations: null,
        }),
      );

      const stats = manager.getStats();
      expect(stats.symbols).toBe(0);
      expect(stats.relations).toBe(0);
      expect(stats.indexed).toBe(true);
    });
  });

  describe('getRepoPath', () => {
    it('should return the resolved repo path', () => {
      expect(manager.getRepoPath()).toBe(path.resolve(testRepoPath));
    });
  });

  describe('isMCPRunning', () => {
    it('should return false when no MCP server is started', () => {
      expect(manager.isMCPRunning()).toBe(false);
    });
  });

  describe('analyze', () => {
    it('should spawn npx gitnexus analyze', async () => {
      const mockOn = vi.fn();
      const mockStdout = { on: vi.fn() };
      const mockStderr = { on: vi.fn() };

      const mockChild = {
        stdout: mockStdout,
        stderr: mockStderr,
        on: mockOn,
      };

      (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        mockChild,
      );

      // Simulate successful exit
      mockOn.mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === 'close') {
          setImmediate(() => cb(0));
        }
      });

      await manager.analyze();

      expect(spawn).toHaveBeenCalledWith(
        'npx',
        ['gitnexus', 'analyze'],
        expect.objectContaining({
          cwd: path.resolve(testRepoPath),
          shell: true,
        }),
      );
    });

    it('should pass --force flag when requested', async () => {
      const mockOn = vi.fn();
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: mockOn,
      };

      (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        mockChild,
      );

      mockOn.mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === 'close') {
          setImmediate(() => cb(0));
        }
      });

      await manager.analyze({ force: true });

      expect(spawn).toHaveBeenCalledWith(
        'npx',
        ['gitnexus', 'analyze', '--force'],
        expect.anything(),
      );
    });

    it('should pass --with-skills flag when requested', async () => {
      const mockOn = vi.fn();
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: mockOn,
      };

      (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        mockChild,
      );

      mockOn.mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === 'close') {
          setImmediate(() => cb(0));
        }
      });

      await manager.analyze({ withSkills: true });

      expect(spawn).toHaveBeenCalledWith(
        'npx',
        ['gitnexus', 'analyze', '--with-skills'],
        expect.anything(),
      );
    });

    it('should reject when analyze exits with non-zero code', async () => {
      const mockOn = vi.fn();
      const mockStderr = {
        on: vi.fn().mockImplementation((event: string, cb: (chunk: Buffer) => void) => {
          if (event === 'data') {
            setImmediate(() => cb(Buffer.from('some error')));
          }
        }),
      };

      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: mockStderr,
        on: mockOn,
      };

      (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        mockChild,
      );

      mockOn.mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === 'close') {
          setImmediate(() => cb(1));
        }
      });

      await expect(manager.analyze()).rejects.toThrow(
        /CodeExplorer analyze exited with code 1/,
      );
    });
  });

  describe('dispose', () => {
    it('should not throw when no MCP server is running', () => {
      expect(() => manager.dispose()).not.toThrow();
    });
  });
});

describe('getCodeExplorerManager (singleton)', () => {
  beforeEach(() => {
    clearCodeExplorerManagerCache();
  });

  afterEach(() => {
    clearCodeExplorerManagerCache();
  });

  it('should return the same instance for the same path', () => {
    const a = getCodeExplorerManager('/test/path');
    const b = getCodeExplorerManager('/test/path');
    expect(a).toBe(b);
  });

  it('should return different instances for different paths', () => {
    const a = getCodeExplorerManager('/test/path-a');
    const b = getCodeExplorerManager('/test/path-b');
    expect(a).not.toBe(b);
  });
});

describe('CodeExplorerMCPClient', () => {
  let client: CodeExplorerMCPClient;

  beforeEach(() => {
    client = new CodeExplorerMCPClient('test-repo');
  });

  afterEach(async () => {
    if (client.isConnected()) {
      await client.disconnect();
    }
  });

  describe('connection lifecycle', () => {
    it('should start disconnected', () => {
      expect(client.isConnected()).toBe(false);
    });

    it('should connect in stub mode', async () => {
      await client.connect();
      expect(client.isConnected()).toBe(true);
    });

    it('should disconnect cleanly', async () => {
      await client.connect();
      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });

    it('should expose the repo name', () => {
      expect(client.getRepoName()).toBe('test-repo');
    });
  });

  describe('tools (stub mode)', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('query should return empty results', async () => {
      const result = await client.query('find authentication flow');
      expect(result).toEqual({ processes: [], definitions: [] });
    });

    it('context should return default symbol context', async () => {
      const result = await client.context('myFunction');
      expect(result.symbol.uid).toBe('myFunction');
      expect(result.symbol.kind).toBe('function');
      expect(result.incoming.calls).toEqual([]);
      expect(result.outgoing.calls).toEqual([]);
      expect(result.processes).toEqual([]);
    });

    it('impact should return low risk default', async () => {
      const result = await client.impact('src/index.ts');
      expect(result.target).toBe('src/index.ts');
      expect(result.affected).toEqual([]);
      expect(result.affectedProcesses).toEqual([]);
      expect(result.riskLevel).toBe('low');
    });

    it('impact should accept direction parameter', async () => {
      const result = await client.impact('src/index.ts', 'downstream');
      expect(result.target).toBe('src/index.ts');
      expect(result.riskLevel).toBe('low');
    });

    it('cypher should return empty array', async () => {
      const result = await client.cypher('MATCH (n) RETURN n LIMIT 5');
      expect(result).toEqual([]);
    });
  });

  describe('resources (stub mode)', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('getClusters should return empty array', async () => {
      expect(await client.getClusters()).toEqual([]);
    });

    it('getProcesses should return empty array', async () => {
      expect(await client.getProcesses()).toEqual([]);
    });

    it('getRepoContext should return empty object', async () => {
      expect(await client.getRepoContext()).toEqual({});
    });

    it('getArchitectureMap should return empty string', async () => {
      expect(await client.getArchitectureMap()).toBe('');
    });
  });

  describe('error handling', () => {
    it('should throw when calling tools without connecting', async () => {
      await expect(client.query('test')).rejects.toThrow(
        'CodeExplorerMCPClient is not connected',
      );
    });

    it('should throw when calling context without connecting', async () => {
      await expect(client.context('sym')).rejects.toThrow(
        'CodeExplorerMCPClient is not connected',
      );
    });

    it('should throw when calling impact without connecting', async () => {
      await expect(client.impact('file.ts')).rejects.toThrow(
        'CodeExplorerMCPClient is not connected',
      );
    });

    it('should throw when calling cypher without connecting', async () => {
      await expect(client.cypher('MATCH (n) RETURN n')).rejects.toThrow(
        'CodeExplorerMCPClient is not connected',
      );
    });

    it('should throw when calling getClusters without connecting', async () => {
      await expect(client.getClusters()).rejects.toThrow(
        'CodeExplorerMCPClient is not connected',
      );
    });

    it('should throw when calling getProcesses without connecting', async () => {
      await expect(client.getProcesses()).rejects.toThrow(
        'CodeExplorerMCPClient is not connected',
      );
    });

    it('should throw when calling getRepoContext without connecting', async () => {
      await expect(client.getRepoContext()).rejects.toThrow(
        'CodeExplorerMCPClient is not connected',
      );
    });

    it('should throw when calling getArchitectureMap without connecting', async () => {
      await expect(client.getArchitectureMap()).rejects.toThrow(
        'CodeExplorerMCPClient is not connected',
      );
    });
  });
});
