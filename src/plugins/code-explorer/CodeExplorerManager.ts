/**
 * CodeExplorer Manager
 *
 * Handles CodeExplorer indexing, stats retrieval, and MCP server lifecycle.
 * CodeExplorer provides code graph analysis (symbols, relations, processes, clusters)
 * and exposes them via an MCP server for agent consumption.
 *
 * Usage:
 *   const mgr = getCodeExplorerManager('/path/to/repo');
 *   if (mgr.isInstalled() && !mgr.isRepoIndexed()) {
 *     await mgr.analyze();
 *   }
 *   await mgr.startMCPServer();
 */

import { execSync, spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../../utils/logger.js';

export interface CodeExplorerStats {
  symbols: number;
  relations: number;
  processes: number;
  clusters: number;
  indexed: boolean;
  stale: boolean;
}

const DEFAULT_STATS: CodeExplorerStats = {
  symbols: 0,
  relations: 0,
  processes: 0,
  clusters: 0,
  indexed: false,
  stale: false,
};

/** Singleton cache keyed by resolved repo path */
const instances = new Map<string, CodeExplorerManager>();

export class CodeExplorerManager {
  private repoPath: string;
  private mcpProcess: ChildProcess | null = null;

  constructor(repoPath: string = process.cwd()) {
    this.repoPath = path.resolve(repoPath);
  }

  /** Check whether the `code-explorer` CLI is available on PATH. */
  isInstalled(): boolean {
    try {
      execSync('code-explorer --version', {
        stdio: 'pipe',
        timeout: 10_000,
        cwd: this.repoPath,
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Check whether the repo has been indexed (`.codeexplorer/` directory exists). */
  isRepoIndexed(): boolean {
    return fs.existsSync(path.join(this.repoPath, '.codeexplorer'));
  }

  /**
   * Run `code-explorer analyze` to index the repository.
   *
   * @param options.force  - Re-index even if `.codeexplorer/` already exists.
   * @param options.withSkills - Also generate skill annotations.
   */
  async analyze(options: { force?: boolean; withSkills?: boolean } = {}): Promise<void> {
    const args = ['analyze'];
    if (options.force) args.push('--force');
    if (options.withSkills) args.push('--with-skills');

    logger.info(`CodeExplorer: analyzing repo at ${this.repoPath}`, { args });

    return new Promise<void>((resolve, reject) => {
      const child = spawn('code-explorer', args, {
        cwd: this.repoPath,
        stdio: 'pipe',
        shell: true,
      });

      let stderr = '';

      child.stdout?.on('data', (chunk: Buffer) => {
        const line = chunk.toString().trim();
        if (line) logger.debug(`CodeExplorer analyze: ${line}`);
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        logger.error('CodeExplorer analyze failed to start', { error: err.message });
        reject(new Error(`CodeExplorer analyze failed to start: ${err.message}`));
      });

      child.on('close', (code) => {
        if (code === 0) {
          logger.info('CodeExplorer: analysis complete');
          resolve();
        } else {
          const msg = `CodeExplorer analyze exited with code ${code}: ${stderr.trim()}`;
          logger.error(msg);
          reject(new Error(msg));
        }
      });
    });
  }

  /**
   * Read stats from `.codeexplorer/meta.json`.
   * Returns defaults if the index does not exist.
   */
  getStats(): CodeExplorerStats {
    const metaPath = path.join(this.repoPath, '.codeexplorer', 'meta.json');
    if (!fs.existsSync(metaPath)) {
      return { ...DEFAULT_STATS };
    }

    try {
      const raw = fs.readFileSync(metaPath, 'utf-8');
      const meta = JSON.parse(raw) as Record<string, unknown>;

      return {
        symbols: typeof meta.symbols === 'number' ? meta.symbols : 0,
        relations: typeof meta.relations === 'number' ? meta.relations : 0,
        processes: typeof meta.processes === 'number' ? meta.processes : 0,
        clusters: typeof meta.clusters === 'number' ? meta.clusters : 0,
        indexed: true,
        stale: meta.stale === true,
      };
    } catch (err) {
      logger.warn('CodeExplorer: failed to read meta.json', {
        error: err instanceof Error ? err.message : String(err),
      });
      return { ...DEFAULT_STATS };
    }
  }

  /**
   * Start the CodeExplorer MCP server as a child process (stdio transport).
   * Only one server is kept alive per manager instance.
   */
  async startMCPServer(): Promise<void> {
    if (this.mcpProcess) {
      logger.debug('CodeExplorer MCP server already running');
      return;
    }

    logger.info('CodeExplorer: starting MCP server');

    this.mcpProcess = spawn('code-explorer', ['mcp'], {
      cwd: this.repoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    this.mcpProcess.on('error', (err) => {
      logger.error('CodeExplorer MCP server error', { error: err.message });
      this.mcpProcess = null;
    });

    this.mcpProcess.on('close', (code) => {
      logger.debug(`CodeExplorer MCP server exited with code ${code}`);
      this.mcpProcess = null;
    });

    // Give the server a moment to start
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    logger.info('CodeExplorer MCP server started');
  }

  /** Stop the MCP server if running. */
  stopMCPServer(): void {
    if (this.mcpProcess) {
      logger.debug('CodeExplorer: stopping MCP server');
      this.mcpProcess.kill();
      this.mcpProcess = null;
    }
  }

  /** Get the repo path this manager is bound to. */
  getRepoPath(): string {
    return this.repoPath;
  }

  /** Whether the MCP server process is currently alive. */
  isMCPRunning(): boolean {
    return this.mcpProcess !== null && !this.mcpProcess.killed;
  }

  /** Clean up resources. */
  dispose(): void {
    this.stopMCPServer();
  }
}

/**
 * Get or create a singleton CodeExplorerManager for the given repo path.
 * Defaults to `process.cwd()` if no path is provided.
 */
export function getCodeExplorerManager(repoPath?: string): CodeExplorerManager {
  const resolved = path.resolve(repoPath || process.cwd());
  let manager = instances.get(resolved);
  if (!manager) {
    manager = new CodeExplorerManager(resolved);
    instances.set(resolved, manager);
  }
  return manager;
}

/** Clear the singleton cache (for testing). */
export function clearCodeExplorerManagerCache(): void {
  instances.forEach((mgr) => mgr.dispose());
  instances.clear();
}
