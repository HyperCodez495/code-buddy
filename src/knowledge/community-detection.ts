/**
 * Community Detection — Label Propagation on the Knowledge Graph
 *
 * Detects architectural sub-systems (clusters of tightly-connected modules)
 * using a deterministic Label Propagation algorithm.
 * Ties are broken by PageRank score to stabilize convergence.
 */

import type { KnowledgeGraph } from './knowledge-graph.js';

// ============================================================================
// Types
// ============================================================================

export interface CommunityConfig {
  /** Which predicate defines edges between modules. Default 'imports' */
  predicate: string;
  /** Entity prefix to cluster. Default 'mod:' */
  entityPrefix: string;
  /** Max iterations. Default 20 */
  maxIterations: number;
  /** Discard communities smaller than this. Default 2 */
  minCommunitySize: number;
  /** Seed for deterministic shuffling. Default 42 */
  seed: number;
}

export interface CommunityResult {
  /** entityId → communityId */
  communities: Map<string, number>;
  /** communityId → size */
  communitySizes: Map<number, number>;
  /** communityId → list of member entities */
  communityMembers: Map<number, string[]>;
  /** Modularity quality score [0, 1] */
  modularity: number;
  /** Timestamp */
  computedAt: number;
}

const DEFAULT_CONFIG: CommunityConfig = {
  predicate: 'imports',
  entityPrefix: 'mod:',
  maxIterations: 20,
  minCommunitySize: 2,
  seed: 42,
};

// ============================================================================
// Algorithm: Label Propagation
// ============================================================================

/**
 * Detect communities using Label Propagation.
 *
 * 1. Each entity gets a unique label.
 * 2. Each iteration, in shuffled order, adopt the most common neighbor label.
 * 3. Ties broken by PageRank (highest-ranked neighbor's label wins).
 * 4. Converge when no labels change, or maxIterations reached.
 * 5. Filter out communities below minCommunitySize.
 */
export function detectCommunities(
  graph: KnowledgeGraph,
  config?: Partial<CommunityConfig>,
  pageRankScores?: Map<string, number>,
): CommunityResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Collect entities with the given prefix
  const entities: string[] = [];
  const allTriples = graph.toJSON();
  const entitySet = new Set<string>();

  for (const t of allTriples) {
    if (t.subject.startsWith(cfg.entityPrefix)) entitySet.add(t.subject);
    if (t.object.startsWith(cfg.entityPrefix)) entitySet.add(t.object);
  }
  entities.push(...entitySet);
  entities.sort(); // deterministic order

  if (entities.length === 0) {
    return {
      communities: new Map(),
      communitySizes: new Map(),
      communityMembers: new Map(),
      modularity: 0,
      computedAt: Date.now(),
    };
  }

  // Build bidirectional adjacency (imports go both ways for community detection)
  const neighbors = new Map<string, Set<string>>();
  const predTriples = graph.query({ predicate: cfg.predicate });
  for (const t of predTriples) {
    if (!t.subject.startsWith(cfg.entityPrefix) || !t.object.startsWith(cfg.entityPrefix)) continue;
    let sn = neighbors.get(t.subject);
    if (!sn) { sn = new Set(); neighbors.set(t.subject, sn); }
    sn.add(t.object);
    let on = neighbors.get(t.object);
    if (!on) { on = new Set(); neighbors.set(t.object, on); }
    on.add(t.subject);
  }

  // Initialize: each entity gets its own label
  const labels = new Map<string, number>();
  for (const [i, entity] of entities.entries()) {
    labels.set(entity, i);
  }

  // Deterministic seeded shuffle
  const order = [...entities];

  for (let iter = 0; iter < cfg.maxIterations; iter++) {
    seededShuffle(order, cfg.seed + iter);
    let changed = false;

    for (const entity of order) {
      const nbrs = neighbors.get(entity);
      if (!nbrs || nbrs.size === 0) continue;

      // Count neighbor label frequencies
      const labelCounts = new Map<number, number>();
      for (const nbr of nbrs) {
        const lbl = labels.get(nbr)!;
        labelCounts.set(lbl, (labelCounts.get(lbl) ?? 0) + 1);
      }

      // Find max frequency
      let maxCount = 0;
      for (const count of labelCounts.values()) {
        if (count > maxCount) maxCount = count;
      }

      // Collect all labels with max frequency
      const candidates: number[] = [];
      for (const [lbl, count] of labelCounts) {
        if (count === maxCount) candidates.push(lbl);
      }

      // Break tie: pick label of the neighbor with highest PageRank
      const firstCandidate = candidates[0] ?? 0; // candidates non-empty (built from neighbor labels); default unreachable
      let bestLabel: number;
      if (candidates.length === 1) {
        bestLabel = firstCandidate;
      } else if (pageRankScores && pageRankScores.size > 0) {
        let bestScore = -1;
        bestLabel = firstCandidate;
        for (const nbr of nbrs) {
          const nbrLabel = labels.get(nbr)!;
          if (candidates.includes(nbrLabel)) {
            const score = pageRankScores.get(nbr) ?? 0;
            if (score > bestScore) {
              bestScore = score;
              bestLabel = nbrLabel;
            }
          }
        }
      } else {
        // Lexicographic tie-break: pick smallest label
        bestLabel = Math.min(...candidates);
      }

      if (labels.get(entity) !== bestLabel) {
        labels.set(entity, bestLabel);
        changed = true;
      }
    }

    if (!changed) break;
  }

  // Renumber labels to sequential IDs
  const labelRemap = new Map<number, number>();
  let nextId = 0;

  const communities = new Map<string, number>();
  const communityMembers = new Map<number, string[]>();

  for (const entity of entities) {
    const rawLabel = labels.get(entity)!;
    if (!labelRemap.has(rawLabel)) {
      labelRemap.set(rawLabel, nextId++);
    }
    const cid = labelRemap.get(rawLabel)!;
    communities.set(entity, cid);

    let members = communityMembers.get(cid);
    if (!members) { members = []; communityMembers.set(cid, members); }
    members.push(entity);
  }

  // Filter by minCommunitySize
  const communitySizes = new Map<number, number>();
  for (const [cid, members] of communityMembers) {
    if (members.length >= cfg.minCommunitySize) {
      communitySizes.set(cid, members.length);
    } else {
      // Remove from communities map
      for (const member of members) {
        communities.delete(member);
      }
      communityMembers.delete(cid);
    }
  }

  // Compute modularity
  const modularity = computeModularity(communities, neighbors, predTriples.length);

  return {
    communities,
    communitySizes,
    communityMembers,
    modularity,
    computedAt: Date.now(),
  };
}

// ============================================================================
// Community Summary
// ============================================================================

/**
 * Generate a human-readable summary for a community.
 * Shows common path prefix, top entities by PageRank, and fn/cls counts.
 */
export function summarizeCommunity(
  graph: KnowledgeGraph,
  members: string[],
  pageRankScores?: Map<string, number>,
): string {
  if (members.length === 0) return '(empty)';

  // Common path prefix
  const paths = members.map(m => m.replace(/^mod:/, ''));
  const prefix = commonPrefix(paths);
  const label = prefix ? prefix.replace(/\/$/, '') : (paths[0] ?? '').split('/').slice(0, 2).join('/');

  // Top-3 by PageRank
  const ranked = [...members].sort((a, b) => {
    const sa = pageRankScores?.get(a) ?? 0;
    const sb = pageRankScores?.get(b) ?? 0;
    return sb - sa;
  });
  const top3 = ranked.slice(0, 3).map(m => m.replace(/^mod:/, '').split('/').pop());

  // Count functions and classes contained
  let fnCount = 0;
  let clsCount = 0;
  for (const member of members) {
    fnCount += graph.query({ subject: member, predicate: 'containsFunction' }).length;
    clsCount += graph.query({ subject: member, predicate: 'contains' })
      .filter(t => t.object.startsWith('cls:')).length;
  }

  const parts = [`${label} (${members.length} modules)`];
  if (top3.length > 0) parts.push(`  top: ${top3.join(', ')}`);
  if (fnCount > 0 || clsCount > 0) {
    parts.push(`  ${fnCount} functions, ${clsCount} classes`);
  }

  return parts.join('\n');
}

// ============================================================================
// Helpers
// ============================================================================

/** Deterministic seeded Fisher-Yates shuffle */
function seededShuffle<T>(arr: T[], seed: number): void {
  let s = seed;
  for (let i = arr.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    const a = arr[i];
    const b = arr[j];
    if (a !== undefined && b !== undefined) {
      arr[i] = b;
      arr[j] = a;
    }
  }
}

/**
 * Compute modularity Q using the standard Newman-Girvan formula:
 *   Q = Σ_c [ L_c/m - (d_c/(2m))² ]
 * where:
 *   L_c = number of edges within community c
 *   d_c = sum of degrees of nodes in community c
 *   m   = total number of edges
 *
 * Result is clamped to [0, 1].
 */
function computeModularity(
  communities: Map<string, number>,
  neighbors: Map<string, Set<string>>,
  totalEdges: number,
): number {
  if (totalEdges === 0) return 0;

  // m = number of undirected edges. Since the neighbor map is bidirectional
  // from directed import triples, totalEdges (import triple count) = undirected edge count
  const m = totalEdges;

  // Gather per-community stats
  const communityEdges = new Map<number, number>(); // L_c: edges within community
  const communityDegree = new Map<number, number>(); // d_c: sum of degrees

  for (const [entity, cid] of communities) {
    const nbrs = neighbors.get(entity);
    const degree = nbrs?.size ?? 0;
    communityDegree.set(cid, (communityDegree.get(cid) ?? 0) + degree);

    if (!nbrs) continue;
    let internalEdges = 0;
    for (const nbr of nbrs) {
      if (communities.get(nbr) === cid) internalEdges++;
    }
    // Each undirected edge counted twice (once from each end), divide by 2 later
    communityEdges.set(cid, (communityEdges.get(cid) ?? 0) + internalEdges);
  }

  let Q = 0;
  for (const [cid] of communityDegree) {
    const Lc = (communityEdges.get(cid) ?? 0) / 2; // undirected edges within community
    const dc = communityDegree.get(cid) ?? 0;
    Q += Lc / m - (dc / (2 * m)) ** 2;
  }

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, Q));
}

/** Find the longest common prefix of a set of strings */
function commonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  if (strings.length === 1) {
    const only = strings[0] ?? '';
    return only.includes('/') ? only.substring(0, only.lastIndexOf('/') + 1) : '';
  }

  const sorted = [...strings].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return '';

  let i = 0;
  while (i < first.length && i < last.length && first[i] === last[i]) i++;

  const prefix = first.substring(0, i);
  // Cut at last /
  const lastSlash = prefix.lastIndexOf('/');
  return lastSlash >= 0 ? prefix.substring(0, lastSlash + 1) : '';
}
