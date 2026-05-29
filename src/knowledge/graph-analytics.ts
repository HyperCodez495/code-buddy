/**
 * Graph Analytics — Dead Code, Coupling Heatmap, Refactoring Suggestions
 *
 * Exploits the code knowledge graph to surface actionable insights:
 *   1. Dead code: entities with 0 incoming calls/imports (with confidence levels)
 *   2. Coupling: inter-module call/import density matrix
 *   3. Refactoring: high-PageRank entities called from many communities
 */

import { KnowledgeGraph } from './knowledge-graph.js';
import type { CommunityResult } from './community-detection.js';
import {
  getAllDynamicEntryMethods,
  getAllEntryPatterns,
  getAllPublicApiModulePatterns,
} from './scanners/framework-plugins.js';

// ============================================================================
// Dead Code Detection
// ============================================================================

/** Confidence level for dead code detection */
export type DeadCodeConfidence = 'high' | 'medium' | 'low';

export interface DeadCodeEntry {
  entity: string;
  confidence: DeadCodeConfidence;
}

export interface DeadCodeResult {
  /** Functions never called by anything in the graph, with confidence */
  uncalledFunctions: string[];
  /** Functions grouped by confidence level */
  byConfidence: { high: string[]; medium: string[]; low: string[] };
  /** Modules never imported by anything */
  unimportedModules: string[];
  /** Classes never extended or instantiated */
  unusedClasses: string[];
  /** Total dead code candidates */
  totalDead: number;
}

/**
 * Method names commonly dispatched dynamically (registries, EventEmitter, etc.).
 * Built from framework plugins + base set for serialization/lifecycle patterns.
 * Functions with these names are downgraded to 'low' confidence.
 */
const DYNAMIC_ENTRY_METHODS = (() => {
  const base = new Set([
    'serialize', 'deserialize', 'toJSON', 'fromJSON',
    'handle', 'process',
  ]);
  // Merge with plugin-declared dynamic methods
  const pluginMethods = getAllDynamicEntryMethods();
  for (const m of pluginMethods) base.add(m);
  return base;
})();

/**
 * Factory/registry function patterns — likely called via dynamic dispatch.
 * Built from framework plugins + base factory patterns.
 */
const FACTORY_PATTERNS = (() => {
  const base = [
    /^fn:create\w+Tools$/, /^fn:create\w+Tool$/, /^fn:get\w+Agent$/,
    /^fn:register\w+/, /^fn:make\w+/, /^fn:build\w+/,
  ];
  return [...base, ...getAllEntryPatterns()];
})();

/**
 * Module path patterns where all exports are considered used (public API surfaces).
 * Built from framework plugins.
 */
const PUBLIC_API_MODULE_PATTERNS = getAllPublicApiModulePatterns();

/**
 * Detect likely dead code: entities with no incoming edges.
 * Excludes entry points (index files, CLI entry, test files).
 * Assigns confidence levels to reduce false positives from dynamic dispatch.
 */
export function detectDeadCode(graph: KnowledgeGraph): DeadCodeResult {
  const ENTRY_PATTERNS = [
    /index$/, /^mod:src\/index/, /\.test/, /\.spec/, /vitest/,
    /^mod:src\/cli/, /^mod:tests\//, /setup/,
  ];

  const isEntryPoint = (id: string): boolean =>
    ENTRY_PATTERNS.some(p => p.test(id));

  // Build set of barrel modules (index files that re-export)
  const barrelModules = new Set<string>();
  for (const t of graph.query({ predicate: 'exports' })) {
    if (t.subject.startsWith('mod:') && /\/index$/.test(t.subject)) {
      barrelModules.add(t.subject);
    }
  }

  // Build set of entities exported from barrels
  const barrelExports = new Set<string>();
  for (const t of graph.query({ predicate: 'exports' })) {
    if (barrelModules.has(t.subject)) {
      barrelExports.add(t.object);
    }
  }

  // Build set of all exported entities (any module)
  const allExported = new Set<string>();
  for (const t of graph.query({ predicate: 'exports' })) {
    allExported.add(t.object);
  }

  // Build function→module map for factory/registry module detection
  const fnToModule = new Map<string, string>();
  for (const t of graph.query({ predicate: 'definedIn' })) {
    if (t.subject.startsWith('fn:')) fnToModule.set(t.subject, t.object);
  }
  for (const t of graph.query({ predicate: 'containsFunction' })) {
    if (t.subject.startsWith('mod:')) fnToModule.set(t.object, t.subject);
  }

  // --- Uncalled functions ---
  const allFunctions = new Set<string>();
  const calledFunctions = new Set<string>();

  for (const t of graph.query({ predicate: 'containsFunction' })) {
    allFunctions.add(t.object);
  }
  for (const t of graph.query({ predicate: 'definedIn' })) {
    if (t.subject.startsWith('fn:')) allFunctions.add(t.subject);
  }
  for (const t of graph.query({ predicate: 'calls' })) {
    calledFunctions.add(t.object);
  }
  // Also count hasMethod targets as "used" if their class is referenced
  for (const t of graph.query({ predicate: 'hasMethod' })) {
    // Method is reachable if class is referenced
    const classCallers = graph.query({ predicate: 'calls', object: t.object });
    if (classCallers.length > 0) calledFunctions.add(t.object);
  }

  const uncalledRaw = [...allFunctions]
    .filter(fn => !calledFunctions.has(fn))
    .filter(fn => !isEntryPoint(fn));

  // Assign confidence to each uncalled function
  const byConfidence = { high: [] as string[], medium: [] as string[], low: [] as string[] };

  for (const fn of uncalledRaw) {
    const confidence = classifyDeadCodeConfidence(fn, barrelExports, allExported, fnToModule);
    byConfidence[confidence].push(fn);
  }

  // Sort each group
  byConfidence.high.sort();
  byConfidence.medium.sort();
  byConfidence.low.sort();

  // uncalledFunctions remains the full list (backwards compat) but sorted by confidence
  const uncalledFunctions = [...byConfidence.high, ...byConfidence.medium, ...byConfidence.low];

  // --- Unimported modules ---
  const allModules = new Set<string>();
  const importedModules = new Set<string>();

  for (const key of ['imports'] as const) {
    for (const t of graph.query({ predicate: key })) {
      if (t.subject.startsWith('mod:')) allModules.add(t.subject);
      if (t.object.startsWith('mod:')) {
        allModules.add(t.object);
        importedModules.add(t.object);
      }
    }
  }

  const unimportedModules = [...allModules]
    .filter(m => !importedModules.has(m))
    .filter(m => !isEntryPoint(m))
    .sort();

  // --- Unused classes ---
  const allClasses = new Set<string>();
  const usedClasses = new Set<string>();

  for (const t of graph.query({ predicate: 'definedIn' })) {
    if (t.subject.startsWith('cls:')) allClasses.add(t.subject);
  }
  for (const t of graph.query({ predicate: 'extends' })) {
    usedClasses.add(t.object);
  }
  for (const t of graph.query({ predicate: 'implements' })) {
    usedClasses.add(t.object);
  }
  // Class is used if any of its methods are called
  for (const t of graph.query({ predicate: 'hasMethod' })) {
    const methodCallers = graph.query({ predicate: 'calls', object: t.object });
    if (methodCallers.length > 0) usedClasses.add(t.subject);
  }

  const unusedClasses = [...allClasses]
    .filter(c => !usedClasses.has(c))
    .filter(c => !isEntryPoint(c))
    .sort();

  return {
    uncalledFunctions,
    byConfidence,
    unimportedModules,
    unusedClasses,
    totalDead: uncalledFunctions.length + unimportedModules.length + unusedClasses.length,
  };
}

/**
 * Classify confidence level for an uncalled function.
 *
 * - **low**: name matches a dynamic entry method, or matches a factory pattern,
 *   or is exported from a barrel (index.ts)
 * - **medium**: exported from a non-barrel module (public API, but not re-exported)
 * - **high**: not exported, no dynamic dispatch patterns — likely truly dead
 */
function classifyDeadCodeConfidence(
  fn: string,
  barrelExports: Set<string>,
  allExported: Set<string>,
  fnToModule: Map<string, string>,
): DeadCodeConfidence {
  // Extract bare method name from fn:ClassName.methodName or fn:funcName
  const parts = fn.replace(/^fn:/, '').split('.');
  // String.split always yields at least one element, so the last index is
  // present; the `?? ''` only satisfies noUncheckedIndexedAccess.
  const bareName = parts[parts.length - 1] ?? '';

  // 1. Dynamic entry method names → low
  if (DYNAMIC_ENTRY_METHODS.has(bareName)) return 'low';

  // 2. Factory/registry patterns → low
  if (FACTORY_PATTERNS.some(p => p.test(fn))) return 'low';

  // 3. Exported from barrel → low (public API surface)
  if (barrelExports.has(fn)) return 'low';

  // 4. Module matches a public API pattern from framework plugins
  const mod = fnToModule.get(fn) ?? '';
  if (PUBLIC_API_MODULE_PATTERNS.some(p => p.test(mod))) return 'low';

  // 5. Module is a registry/factory (heuristic fallback)
  if (/\b(registry|factory|adapters?|plugins?|providers?)\b/i.test(mod)) return 'low';

  // 6. Exported from any module → medium (public but not barrel-exported)
  if (allExported.has(fn)) return 'medium';

  // 7. Default → high confidence dead code
  return 'high';
}

// ============================================================================
// Coupling Heatmap
// ============================================================================

export interface CouplingEntry {
  moduleA: string;
  moduleB: string;
  /** Number of call edges from A to B */
  calls: number;
  /** Number of import edges from A to B */
  imports: number;
  /** Total coupling strength */
  total: number;
}

export interface CouplingResult {
  /** Top coupled pairs sorted by total strength */
  hotspots: CouplingEntry[];
  /** Average coupling across all module pairs */
  averageCoupling: number;
  /** Module with the most outgoing dependencies */
  mostDependentModule: string | null;
  /** Module with the most incoming dependencies */
  mostDependendUponModule: string | null;
}

/**
 * Compute inter-module coupling matrix.
 * Counts calls + imports between every pair of modules.
 */
export function computeCoupling(graph: KnowledgeGraph, topN: number = 20): CouplingResult {
  // Build function→module map
  const fnToModule = new Map<string, string>();
  for (const t of graph.query({ predicate: 'definedIn' })) {
    if (t.object.startsWith('mod:')) fnToModule.set(t.subject, t.object);
  }
  for (const t of graph.query({ predicate: 'containsFunction' })) {
    if (t.subject.startsWith('mod:')) fnToModule.set(t.object, t.subject);
  }

  // Count cross-module calls
  const couplingMap = new Map<string, { calls: number; imports: number }>();

  const makeKey = (a: string, b: string) => a < b ? `${a}|||${b}` : `${b}|||${a}`;

  for (const t of graph.query({ predicate: 'calls' })) {
    const modA = fnToModule.get(t.subject);
    const modB = fnToModule.get(t.object);
    if (modA && modB && modA !== modB) {
      const key = makeKey(modA, modB);
      const entry = couplingMap.get(key) ?? { calls: 0, imports: 0 };
      entry.calls++;
      couplingMap.set(key, entry);
    }
  }

  for (const t of graph.query({ predicate: 'imports' })) {
    if (t.subject.startsWith('mod:') && t.object.startsWith('mod:')) {
      const key = makeKey(t.subject, t.object);
      const entry = couplingMap.get(key) ?? { calls: 0, imports: 0 };
      entry.imports++;
      couplingMap.set(key, entry);
    }
  }

  const hotspots: CouplingEntry[] = [];
  for (const [key, { calls, imports }] of couplingMap) {
    // Keys are built by makeKey as `${a}|||${b}`, so the split always yields
    // both parts; the `?? ''` only satisfies noUncheckedIndexedAccess.
    const [moduleA = '', moduleB = ''] = key.split('|||');
    hotspots.push({ moduleA, moduleB, calls, imports, total: calls + imports });
  }
  hotspots.sort((a, b) => b.total - a.total);

  // Stats
  const totalCoupling = hotspots.reduce((s, e) => s + e.total, 0);
  const averageCoupling = hotspots.length > 0 ? totalCoupling / hotspots.length : 0;

  // Most dependent module (outgoing)
  const outDeps = new Map<string, number>();
  const inDeps = new Map<string, number>();
  for (const e of hotspots) {
    outDeps.set(e.moduleA, (outDeps.get(e.moduleA) ?? 0) + e.total);
    outDeps.set(e.moduleB, (outDeps.get(e.moduleB) ?? 0) + e.total);
    inDeps.set(e.moduleA, (inDeps.get(e.moduleA) ?? 0) + e.total);
    inDeps.set(e.moduleB, (inDeps.get(e.moduleB) ?? 0) + e.total);
  }

  let mostDependentModule: string | null = null;
  let maxOut = 0;
  for (const [m, c] of outDeps) { if (c > maxOut) { maxOut = c; mostDependentModule = m; } }

  let mostDependendUponModule: string | null = null;
  let maxIn = 0;
  for (const [m, c] of inDeps) { if (c > maxIn) { maxIn = c; mostDependendUponModule = m; } }

  return {
    hotspots: hotspots.slice(0, topN),
    averageCoupling,
    mostDependentModule,
    mostDependendUponModule,
  };
}

// ============================================================================
// Refactoring Suggestions
// ============================================================================

export interface RefactorSuggestion {
  entity: string;
  pageRank: number;
  /** Number of distinct communities that call this entity */
  crossCommunityCallers: number;
  /** Total number of callers */
  totalCallers: number;
  /** Reason for suggestion */
  reason: string;
}

/**
 * Identify refactoring candidates:
 * - High PageRank + called from many communities → extract to shared module
 * - God functions (too many outgoing calls)
 * - Hub modules (too many imports)
 */
export function suggestRefactoring(
  graph: KnowledgeGraph,
  communities?: CommunityResult,
  topN: number = 15,
): RefactorSuggestion[] {
  const suggestions: RefactorSuggestion[] = [];

  let prScores: Map<string, number>;
  try { prScores = graph.getPageRank(); } catch { return []; }

  // Build function→module map
  const fnToModule = new Map<string, string>();
  for (const t of graph.query({ predicate: 'definedIn' })) {
    fnToModule.set(t.subject, t.object);
  }
  for (const t of graph.query({ predicate: 'containsFunction' })) {
    fnToModule.set(t.object, t.subject);
  }

  // 1. Cross-community hub functions
  const allCalledEntities = new Set<string>();
  for (const t of graph.query({ predicate: 'calls' })) {
    allCalledEntities.add(t.object);
  }

  for (const entity of allCalledEntities) {
    const rank = prScores.get(entity) ?? 0;
    if (rank < 0.1) continue; // Skip low-rank

    const callers = graph.query({ predicate: 'calls', object: entity });
    if (callers.length < 3) continue;

    let crossCommunityCallers = 0;
    if (communities) {
      const callerCommunities = new Set<number>();
      for (const t of callers) {
        const callerMod = fnToModule.get(t.subject);
        if (callerMod) {
          const cid = communities.communities.get(callerMod);
          if (cid !== undefined) callerCommunities.add(cid);
        }
      }
      crossCommunityCallers = callerCommunities.size;
    }

    if (crossCommunityCallers >= 3 || callers.length >= 10) {
      suggestions.push({
        entity,
        pageRank: rank,
        crossCommunityCallers,
        totalCallers: callers.length,
        reason: crossCommunityCallers >= 3
          ? `Called from ${crossCommunityCallers} different architectural clusters — consider extracting to a shared utility module`
          : `Called by ${callers.length} functions — high coupling, consider interface extraction`,
      });
    }
  }

  // 2. God functions (outgoing calls > 15)
  for (const [entity, rank] of prScores) {
    if (!entity.startsWith('fn:')) continue;
    const outCalls = graph.query({ subject: entity, predicate: 'calls' });
    if (outCalls.length > 15) {
      suggestions.push({
        entity,
        pageRank: rank,
        crossCommunityCallers: 0,
        totalCallers: 0,
        reason: `Makes ${outCalls.length} outgoing calls — god function, consider breaking into smaller units`,
      });
    }
  }

  // 3. Hub modules (imports > 20)
  for (const [entity, rank] of prScores) {
    if (!entity.startsWith('mod:')) continue;
    const imports = graph.query({ subject: entity, predicate: 'imports' });
    if (imports.length > 20) {
      suggestions.push({
        entity,
        pageRank: rank,
        crossCommunityCallers: 0,
        totalCallers: 0,
        reason: `Imports ${imports.length} modules — hub module, may benefit from dependency inversion`,
      });
    }
  }

  // Sort by PageRank descending
  suggestions.sort((a, b) => b.pageRank - a.pageRank);
  return suggestions.slice(0, topN);
}
