/**
 * Community Detection — GitNexus Knowledge Graph
 *
 * Simplified label propagation algorithm for detecting architectural
 * modules/clusters in the code graph. Each node starts with its own
 * label, then iteratively adopts the most common label among its
 * neighbors until stable.
 *
 * This is simpler than full Louvain/Leiden but sufficient for v1.
 */

import { KnowledgeGraph } from './knowledge-graph.js';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface Community {
  id: number;
  name: string;
  symbols: string[];
  files: string[];
  cohesion: number;
  entryPoints: string[];
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Build an adjacency list from the knowledge graph.
 * Includes all edge types (calls, imports, extends, etc.)
 */
function buildAdjacencyList(graph: KnowledgeGraph): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();

  const addEdge = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };

  const triples = graph.toJSON();
  for (const t of triples) {
    // Skip metadata-like predicates
    if (['typeof', 'importCount', 'hasDirectory', 'patternOf'].includes(t.predicate)) {
      continue;
    }
    addEdge(t.subject, t.object);
  }

  return adj;
}

/**
 * Find the most common label among a node's neighbors.
 * Ties are broken by picking the smallest label (deterministic).
 */
function mostCommonNeighborLabel(
  node: string,
  adj: Map<string, Set<string>>,
  labels: Map<string, number>,
): number {
  const neighbors = adj.get(node);
  if (!neighbors || neighbors.size === 0) {
    return labels.get(node) ?? 0;
  }

  const counts = new Map<number, number>();
  for (const neighbor of neighbors) {
    const label = labels.get(neighbor);
    if (label !== undefined) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }

  if (counts.size === 0) {
    return labels.get(node) ?? 0;
  }

  // Find max count
  let maxCount = 0;
  for (const c of counts.values()) {
    if (c > maxCount) maxCount = c;
  }

  // Among labels with maxCount, pick smallest (deterministic tie-break)
  let bestLabel = Infinity;
  for (const [label, count] of counts) {
    if (count === maxCount && label < bestLabel) {
      bestLabel = label;
    }
  }

  return bestLabel;
}

/**
 * Extract file path from a symbol.
 */
function symbolToFile(symbol: string, graph: KnowledgeGraph): string {
  const definedIn = graph.query({ subject: symbol, predicate: 'definedIn' });
  const firstDefinedIn = definedIn[0];
  if (firstDefinedIn) return firstDefinedIn.object.replace(/^mod:/, '');

  const belongsTo = graph.query({ subject: symbol, predicate: 'belongsTo' });
  const firstBelongsTo = belongsTo[0];
  if (firstBelongsTo) return firstBelongsTo.object.replace(/^mod:/, '');

  if (symbol.startsWith('mod:')) return symbol.replace(/^mod:/, '');

  if (symbol.includes('/')) {
    const parts = symbol.split(':');
    return parts.length > 1 ? parts.slice(1).join(':') : (parts[0] ?? symbol);
  }

  return '';
}

/**
 * Generate a human-readable name for a community based on common paths.
 */
function nameCommunity(symbols: string[], graph: KnowledgeGraph): string {
  const files = symbols
    .map(s => symbolToFile(s, graph))
    .filter(f => f.length > 0);

  if (files.length === 0) return 'Unknown Module';

  // Extract directory components
  const dirCounts = new Map<string, number>();
  for (const file of files) {
    const parts = file.replace(/\\/g, '/').split('/');
    // Use the most specific non-leaf directory
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts[i];
      if (dir && dir !== 'src' && dir !== 'lib' && dir !== 'dist') {
        dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
      }
    }
  }

  if (dirCounts.size === 0) return 'Core Module';

  // Find most common directory
  let bestDir = '';
  let bestCount = 0;
  for (const [dir, count] of dirCounts) {
    if (count > bestCount) {
      bestCount = count;
      bestDir = dir;
    }
  }

  // Capitalize and format
  const formatted = bestDir
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  return formatted + ' Module';
}

/**
 * Calculate cohesion for a community.
 * cohesion = internal edges / total edges of community members
 */
function calculateCohesion(
  symbols: Set<string>,
  adj: Map<string, Set<string>>,
): number {
  let internalEdges = 0;
  let totalEdges = 0;

  for (const sym of symbols) {
    const neighbors = adj.get(sym);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      totalEdges++;
      if (symbols.has(neighbor)) {
        internalEdges++;
      }
    }
  }

  if (totalEdges === 0) return 0;
  return internalEdges / totalEdges;
}

/**
 * Find entry points within a community (nodes with external callers).
 */
function findEntryPoints(
  symbols: Set<string>,
  adj: Map<string, Set<string>>,
  graph: KnowledgeGraph,
): string[] {
  const entryPoints: string[] = [];

  for (const sym of symbols) {
    // Check if this symbol is called from outside the community
    const callers = graph.query({ predicate: 'calls', object: sym });
    const hasExternalCaller = callers.some(t => !symbols.has(t.subject));

    // Check if it's exported
    const exports = graph.query({ predicate: 'exports', object: sym });
    const exposes = graph.query({ predicate: 'exposes', object: sym });

    if (hasExternalCaller || exports.length > 0 || exposes.length > 0) {
      entryPoints.push(sym);
    }
  }

  return entryPoints;
}

// ============================================================================
// Public API
// ============================================================================

const MAX_ITERATIONS = 10;
const MIN_COMMUNITY_SIZE = 3;

/**
 * Detect communities (architectural modules) in the code graph
 * using label propagation.
 *
 * @param graph - KnowledgeGraph to analyze
 * @param options - Optional configuration
 * @returns Array of detected communities
 */
export function detectCommunities(
  graph: KnowledgeGraph,
  options?: {
    minSize?: number;
    maxIterations?: number;
  },
): Community[] {
  const minSize = options?.minSize ?? MIN_COMMUNITY_SIZE;
  const maxIterations = options?.maxIterations ?? MAX_ITERATIONS;

  const adj = buildAdjacencyList(graph);
  const nodes = [...adj.keys()];

  if (nodes.length === 0) return [];

  // Initialize: each node gets its own label
  const labels = new Map<string, number>();
  for (const [i, node] of nodes.entries()) {
    labels.set(node, i);
  }

  // Iterate: each node adopts the most common label among neighbors
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    // Shuffle nodes for randomized propagation (deterministic with seed)
    const shuffled = [...nodes];
    for (let i = shuffled.length - 1; i > 0; i--) {
      // Simple deterministic shuffle based on iteration
      const j = (i * (iter + 1) * 31) % (i + 1);
      const a = shuffled[i];
      const b = shuffled[j];
      // Both i (1..length-1) and j (0..i via modulo) are in bounds, so a/b
      // are defined; guard only to satisfy the type checker without changing behavior.
      if (a === undefined || b === undefined) continue;
      shuffled[i] = b;
      shuffled[j] = a;
    }

    for (const node of shuffled) {
      const newLabel = mostCommonNeighborLabel(node, adj, labels);
      const oldLabel = labels.get(node)!;
      if (newLabel !== oldLabel) {
        labels.set(node, newLabel);
        changed = true;
      }
    }

    if (!changed) {
      logger.debug(`CommunityDetector: converged after ${iter + 1} iterations`);
      break;
    }
  }

  // Group by final label
  const groups = new Map<number, string[]>();
  for (const [node, label] of labels) {
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(node);
  }

  // Filter by minimum size and build communities
  const communities: Community[] = [];
  let communityId = 0;

  for (const [, members] of groups) {
    if (members.length < minSize) continue;

    const symbolSet = new Set(members);
    const files = [...new Set(
      members
        .map(s => symbolToFile(s, graph))
        .filter(f => f.length > 0)
    )];

    communities.push({
      id: communityId++,
      name: nameCommunity(members, graph),
      symbols: members.sort(),
      files: files.sort(),
      cohesion: calculateCohesion(symbolSet, adj),
      entryPoints: findEntryPoints(symbolSet, adj, graph),
    });
  }

  // Sort by size descending
  communities.sort((a, b) => b.symbols.length - a.symbols.length);

  logger.debug(`CommunityDetector: found ${communities.length} communities from ${nodes.length} nodes`);
  return communities;
}
