/**
 * Impact Analyzer
 *
 * Transitive impact analysis: "If I change function X, what else is affected?"
 * Uses BFS on reverse call edges to find all transitive callers.
 */

import { KnowledgeGraph } from './knowledge-graph.js';

export interface ImpactResult {
  /** The analyzed entity */
  entity: string;
  /** Direct callers (1-hop) */
  directCallers: string[];
  /** Indirect callers (2+ hops) */
  indirectCallers: string[];
  /** All affected modules (files) */
  affectedFiles: string[];
  /** Total impact count */
  totalAffected: number;
  /** Formatted output for LLM consumption */
  formatted: string;
}

/**
 * Analyze the transitive impact of modifying an entity.
 * @param maxDepth - How many levels of callers to trace (default 5)
 */
export function analyzeImpact(
  graph: KnowledgeGraph,
  entity: string,
  maxDepth: number = 5,
): ImpactResult {
  const directCallers: string[] = [];
  const indirectCallers: string[] = [];
  const affectedModules = new Set<string>();

  // Direct callers (1-hop)
  const direct = graph.query({ predicate: 'calls', object: entity });
  for (const t of direct) {
    directCallers.push(t.subject);
  }

  // Transitive callers (BFS, depth > 1)
  const visited = new Set<string>([entity, ...directCallers]);
  const queue: Array<{ node: string; depth: number }> = directCallers.map(c => ({ node: c, depth: 1 }));

  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const callers = graph.query({ predicate: 'calls', object: node });
    for (const t of callers) {
      if (!visited.has(t.subject)) {
        visited.add(t.subject);
        indirectCallers.push(t.subject);
        queue.push({ node: t.subject, depth: depth + 1 });
      }
    }
  }

  // Find affected modules
  const allAffected = [entity, ...directCallers, ...indirectCallers];
  for (const fn of allAffected) {
    // Look up definedIn for functions
    const definedIn = graph.query({ subject: fn, predicate: 'definedIn' });
    for (const t of definedIn) {
      affectedModules.add(t.object);
    }
    // Also check containsFunction reverse
    const containedIn = graph.query({ predicate: 'containsFunction', object: fn });
    for (const t of containedIn) {
      affectedModules.add(t.subject);
    }
  }

  // Transitively follow import chains: if module A imports module B which
  // defines the changed entity, and module C imports A, C is also affected.
  const entityModule = graph.query({ subject: entity, predicate: 'definedIn' });
  const firstEntityModule = entityModule[0];
  if (firstEntityModule !== undefined) {
    const mod = firstEntityModule.object;
    const importVisited = new Set<string>([mod]);
    const importQueue: Array<{ node: string; depth: number }> = [{ node: mod, depth: 0 }];
    const importMaxDepth = Math.min(maxDepth, 3); // cap import chain depth

    while (importQueue.length > 0) {
      const { node, depth } = importQueue.shift()!;
      const importers = graph.query({ predicate: 'imports', object: node });
      for (const t of importers) {
        affectedModules.add(t.subject);
        if (!importVisited.has(t.subject) && depth + 1 < importMaxDepth) {
          importVisited.add(t.subject);
          importQueue.push({ node: t.subject, depth: depth + 1 });
        }
      }
    }
  }

  const affectedFiles = [...affectedModules].sort();
  const totalAffected = directCallers.length + indirectCallers.length;

  // Format output
  const lines: string[] = [];
  lines.push(`Impact Analysis: ${entity}`);
  lines.push(`Total affected: ${totalAffected} functions across ${affectedFiles.length} files\n`);

  if (directCallers.length > 0) {
    lines.push(`Direct callers (${directCallers.length}):`);
    for (const c of directCallers.slice(0, 15)) {
      lines.push(`  ${c}`);
    }
    if (directCallers.length > 15) lines.push(`  +${directCallers.length - 15} more`);
    lines.push('');
  }

  if (indirectCallers.length > 0) {
    lines.push(`Indirect callers (${indirectCallers.length}):`);
    for (const c of indirectCallers.slice(0, 15)) {
      lines.push(`  ${c}`);
    }
    if (indirectCallers.length > 15) lines.push(`  +${indirectCallers.length - 15} more`);
    lines.push('');
  }

  if (affectedFiles.length > 0) {
    lines.push(`Affected files (${affectedFiles.length}):`);
    for (const f of affectedFiles.slice(0, 20)) {
      lines.push(`  ${f}`);
    }
    if (affectedFiles.length > 20) lines.push(`  +${affectedFiles.length - 20} more`);
  }

  return {
    entity,
    directCallers,
    indirectCallers,
    affectedFiles,
    totalAffected,
    formatted: lines.join('\n'),
  };
}
