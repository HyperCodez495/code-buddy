/**
 * CodeExplorer MCP Client
 *
 * Talks to a CodeExplorer MCP server to query the code graph.
 * Currently operates in **stub mode** — all methods return empty/default
 * results so the rest of the codebase can integrate without requiring
 * a real CodeExplorer installation. The real MCP transport will be wired
 * in a follow-up once code-explorer is available.
 *
 * Tools exposed by CodeExplorer MCP:
 *   - query   — natural-language search over the code graph
 *   - context — symbol-level call/import graph + process membership
 *   - impact  — blast-radius analysis (upstream/downstream)
 *   - cypher  — raw Cypher queries against the graph
 *
 * Resources:
 *   - clusters         — module clusters with cohesion scores
 *   - processes         — detected business processes
 *   - repo-context      — high-level repo metadata
 *   - architecture-map  — Mermaid architecture diagram
 */

import { logger } from '../../utils/logger.js';

// ── Response Types ──────────────────────────────────────────────────

export interface GNQueryResult {
  processes: Array<{
    summary: string;
    priority: number;
    symbol_count: number;
  }>;
  definitions: Array<{
    name: string;
    type: string;
    filePath: string;
  }>;
}

export interface GNContextResult {
  symbol: {
    uid: string;
    kind: string;
    filePath: string;
    startLine: number;
  };
  incoming: {
    calls: string[];
    imports: string[];
  };
  outgoing: {
    calls: string[];
    imports: string[];
  };
  processes: Array<{
    name: string;
    step: string;
  }>;
}

export interface GNImpactResult {
  target: string;
  affected: Array<{
    name: string;
    depth: number;
    risk: 'high' | 'medium' | 'low';
  }>;
  affectedProcesses: string[];
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
}

export interface GNCluster {
  name: string;
  cohesion: number;
  members: string[];
  filePaths: string[];
}

export interface GNProcess {
  name: string;
  steps: Array<{
    symbol: string;
    filePath: string;
    stepIndex: number;
  }>;
}

// ── Client ──────────────────────────────────────────────────────────

export class CodeExplorerMCPClient {
  private repoName: string;
  private connected = false;

  constructor(repoName: string) {
    this.repoName = repoName;
  }

  /**
   * Connect to the CodeExplorer MCP server.
   *
   * In the real implementation this will use `@modelcontextprotocol/sdk`
   * `StdioClientTransport` with:
   *   command: 'npx'
   *   args: ['-y', 'code-explorer@latest', 'mcp']
   *
   * For now this is a stub that marks the client as connected.
   */
  async connect(): Promise<void> {
    this.connected = true;
    logger.debug('CodeExplorer MCP client connected (stub mode)', {
      repo: this.repoName,
    });
  }

  /** Disconnect from the MCP server. */
  async disconnect(): Promise<void> {
    this.connected = false;
    logger.debug('CodeExplorer MCP client disconnected', {
      repo: this.repoName,
    });
  }

  /** Whether the client is currently connected. */
  isConnected(): boolean {
    return this.connected;
  }

  /** The repo name this client is targeting. */
  getRepoName(): string {
    return this.repoName;
  }

  // ── Tools ───────────────────────────────────────────────────────

  /**
   * Natural-language query against the code graph.
   * Returns matching processes and symbol definitions.
   */
  async query(q: string): Promise<GNQueryResult> {
    this.assertConnected();
    logger.debug('CodeExplorer query', { query: q, repo: this.repoName });
    // Stub: real impl calls callTool('query', { query: q, repo: this.repoName })
    return { processes: [], definitions: [] };
  }

  /**
   * Get the full context for a symbol: call graph, import graph,
   * and the business processes it participates in.
   */
  async context(symbolName: string): Promise<GNContextResult> {
    this.assertConnected();
    logger.debug('CodeExplorer context', { symbol: symbolName, repo: this.repoName });
    return {
      symbol: {
        uid: symbolName,
        kind: 'function',
        filePath: '',
        startLine: 0,
      },
      incoming: { calls: [], imports: [] },
      outgoing: { calls: [], imports: [] },
      processes: [],
    };
  }

  /**
   * Blast-radius / impact analysis for a given symbol or file.
   *
   * @param target    - Symbol or file path to analyze
   * @param direction - 'upstream' (what depends on target) or 'downstream' (what target depends on)
   */
  async impact(
    target: string,
    direction: 'upstream' | 'downstream' = 'upstream',
  ): Promise<GNImpactResult> {
    this.assertConnected();
    logger.debug('CodeExplorer impact', { target, direction, repo: this.repoName });
    return {
      target,
      affected: [],
      affectedProcesses: [],
      riskLevel: 'low',
    };
  }

  /**
   * Execute a raw Cypher query against the CodeExplorer graph database.
   */
  async cypher(query: string): Promise<unknown[]> {
    this.assertConnected();
    logger.debug('CodeExplorer cypher', { query, repo: this.repoName });
    return [];
  }

  // ── Resources ───────────────────────────────────────────────────

  /** Get all detected module clusters with cohesion scores. */
  async getClusters(): Promise<GNCluster[]> {
    this.assertConnected();
    return [];
  }

  /** Get all detected business processes. */
  async getProcesses(): Promise<GNProcess[]> {
    this.assertConnected();
    return [];
  }

  /** Get high-level repository context metadata. */
  async getRepoContext(): Promise<Record<string, unknown>> {
    this.assertConnected();
    return {};
  }

  /** Get a Mermaid architecture diagram of the repository. */
  async getArchitectureMap(): Promise<string> {
    this.assertConnected();
    return '';
  }

  // ── Internal ────────────────────────────────────────────────────

  private assertConnected(): void {
    if (!this.connected) {
      throw new Error('CodeExplorerMCPClient is not connected. Call connect() first.');
    }
  }
}
