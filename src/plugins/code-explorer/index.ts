/**
 * CodeExplorer Plugin — Barrel Export
 *
 * Code graph analysis via CodeExplorer MCP server integration.
 */

export {
  CodeExplorerManager,
  getCodeExplorerManager,
  clearCodeExplorerManagerCache,
} from './CodeExplorerManager.js';

export { CodeExplorerMCPClient } from './CodeExplorerMCPClient.js';

export type {
  GNQueryResult,
  GNContextResult,
  GNImpactResult,
  GNCluster,
  GNProcess,
} from './CodeExplorerMCPClient.js';

export type { CodeExplorerStats } from './CodeExplorerManager.js';
