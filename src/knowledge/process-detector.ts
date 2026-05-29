/**
 * Process Detection — GitNexus Knowledge Graph
 *
 * Detects execution flows by BFS from entry points in the code graph.
 * Entry points are functions with no internal callers (or matching
 * main/handler/route patterns).
 *
 * Each process is a named sequence of steps (calls/imports/extends)
 * starting from an entry point, with a minimum of 3 steps.
 */

import { KnowledgeGraph } from './knowledge-graph.js';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ProcessStep {
  symbolName: string;
  filePath: string;
  stepIndex: number;
  type: 'call' | 'import' | 'extend';
}

export interface ExecutionProcess {
  name: string;
  entryPoint: string;
  steps: ProcessStep[];
  files: string[];
}

// ============================================================================
// Entry Point Detection
// ============================================================================

/** Pattern names that suggest entry points */
const ENTRY_POINT_PATTERNS = [
  /^main$/i,
  /^handle/i,
  /^route/i,
  /^on[A-Z]/,
  /^process/i,
  /^execute/i,
  /^start/i,
  /^init/i,
  /^run/i,
  /^serve/i,
  /^listen/i,
  /^dispatch/i,
  /^controller/i,
  /^middleware/i,
  /^endpoint/i,
];

/**
 * Score a symbol as a potential entry point.
 * Higher score = more likely to be an entry point.
 */
function scoreEntryPoint(
  symbol: string,
  graph: KnowledgeGraph,
): number {
  let score = 0;

  // Check if the symbol has internal callers (is called by others)
  const callers = graph.query({ predicate: 'calls', object: symbol });
  if (callers.length === 0) {
    score += 8; // No callers → likely an entry point
  }

  // Check if the symbol is used by other modules
  const usedBy = graph.query({ predicate: 'usedBy', object: symbol });
  if (usedBy.length === 0) {
    score += 3;
  }

  // Extract bare name from prefixed IDs (e.g., "fn:handleLogin" → "handleLogin")
  const bareName = symbol.includes(':') ? symbol.split(':').pop()! : symbol;
  // Strip path components if present
  const simpleName = bareName.includes('/') ? bareName.split('/').pop()! : bareName;

  // Pattern matching bonus
  for (const pattern of ENTRY_POINT_PATTERNS) {
    if (pattern.test(simpleName)) {
      score += 5;
      break;
    }
  }

  // Public/exported symbols get a bonus
  const exports = graph.query({ predicate: 'exports', object: symbol });
  const exposes = graph.query({ predicate: 'exposes', object: symbol });
  if (exports.length > 0 || exposes.length > 0) {
    score += 10;
  }

  // Must have outgoing calls to be a meaningful entry point
  const callees = graph.query({ subject: symbol, predicate: 'calls' });
  if (callees.length === 0) {
    score -= 5; // Leaf nodes are not interesting entry points
  }

  return score;
}

// ============================================================================
// Process Name Heuristic
// ============================================================================

/**
 * Generate a human-readable process name from an entry point symbol.
 * e.g., "handleLogin" → "Login Flow", "processPayment" → "Payment Processing"
 */
function nameFromEntryPoint(symbol: string): string {
  // Extract bare name
  let name = symbol.includes(':') ? symbol.split(':').pop()! : symbol;
  name = name.includes('/') ? name.split('/').pop()! : name;

  // Remove common prefixes
  const prefixes = ['handle', 'process', 'execute', 'on', 'do', 'run', 'start', 'init'];
  let stripped = name;
  for (const prefix of prefixes) {
    if (name.toLowerCase().startsWith(prefix) && name.length > prefix.length) {
      stripped = name.slice(prefix.length);
      // Ensure first char is uppercase
      stripped = stripped.charAt(0).toUpperCase() + stripped.slice(1);
      break;
    }
  }

  // Split camelCase/PascalCase into words
  const words = stripped.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_-]+/);

  // Build name
  const cleanWords = words.filter(w => w.length > 0).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  const lastWord = cleanWords[cleanWords.length - 1];
  if (lastWord === undefined) return `${name} Flow`;

  // Add suffix based on context
  const last = lastWord.toLowerCase();
  if (['flow', 'process', 'processing', 'pipeline', 'workflow', 'handler'].includes(last)) {
    return cleanWords.join(' ');
  }

  return cleanWords.join(' ') + ' Flow';
}

// ============================================================================
// BFS Process Detection
// ============================================================================

/**
 * Extract file path from a symbol's metadata or definedIn relations.
 */
function getFilePath(symbol: string, graph: KnowledgeGraph): string {
  // Check definedIn relation
  const definedIn = graph.query({ subject: symbol, predicate: 'definedIn' });
  const definedInFirst = definedIn[0];
  if (definedInFirst !== undefined) {
    return definedInFirst.object.replace(/^mod:/, '');
  }

  // Check belongsTo relation
  const belongsTo = graph.query({ subject: symbol, predicate: 'belongsTo' });
  const belongsToFirst = belongsTo[0];
  if (belongsToFirst !== undefined) {
    return belongsToFirst.object.replace(/^mod:/, '');
  }

  // Try extracting from the symbol name itself (e.g., "fn:src/auth/login")
  if (symbol.includes('/')) {
    const parts = symbol.split(':');
    const path = parts.length > 1 ? parts.slice(1).join(':') : parts[0];
    return path ?? symbol;
  }

  return 'unknown';
}

/**
 * BFS from an entry point through CALLS/imports/extends edges.
 */
function bfsFromEntry(
  entryPoint: string,
  graph: KnowledgeGraph,
  maxSteps: number = 30,
): ProcessStep[] {
  const visited = new Set<string>();
  const steps: ProcessStep[] = [];

  const queue: Array<{ symbol: string; depth: number }> = [
    { symbol: entryPoint, depth: 0 },
  ];

  visited.add(entryPoint);

  while (queue.length > 0 && steps.length < maxSteps) {
    const { symbol, depth } = queue.shift()!;

    const filePath = getFilePath(symbol, graph);

    steps.push({
      symbolName: symbol,
      filePath,
      stepIndex: steps.length,
      type: depth === 0 ? 'call' : 'call',
    });

    // Follow CALLS edges
    const callees = graph.query({ subject: symbol, predicate: 'calls' });
    for (const triple of callees) {
      if (!visited.has(triple.object)) {
        visited.add(triple.object);
        queue.push({ symbol: triple.object, depth: depth + 1 });
      }
    }

    // Follow imports edges (less common but relevant)
    const imports = graph.query({ subject: symbol, predicate: 'imports' });
    for (const triple of imports) {
      if (!visited.has(triple.object)) {
        visited.add(triple.object);
        queue.push({ symbol: triple.object, depth: depth + 1 });
      }
    }

    // Follow extends edges
    const extends_ = graph.query({ subject: symbol, predicate: 'extends' });
    for (const triple of extends_) {
      if (!visited.has(triple.object)) {
        visited.add(triple.object);
        queue.push({ symbol: triple.object, depth: depth + 1 });
      }
    }
  }

  // Set correct types based on edge type
  // Re-walk to fix types
  const typeMap = new Map<string, 'call' | 'import' | 'extend'>();
  typeMap.set(entryPoint, 'call');

  for (const step of steps) {
    const sym = step.symbolName;
    const calls = graph.query({ predicate: 'calls', object: sym });
    const imports = graph.query({ predicate: 'imports', object: sym });
    const extends_ = graph.query({ predicate: 'extends', object: sym });

    if (calls.length > 0) step.type = 'call';
    else if (imports.length > 0) step.type = 'import';
    else if (extends_.length > 0) step.type = 'extend';
  }

  return steps;
}

/**
 * Check if process A's steps are a subset of process B's steps.
 */
function isSubsetProcess(a: ExecutionProcess, b: ExecutionProcess): boolean {
  if (a.steps.length >= b.steps.length) return false;

  const bSymbols = new Set(b.steps.map(s => s.symbolName));
  return a.steps.every(s => bSymbols.has(s.symbolName));
}

// ============================================================================
// Public API
// ============================================================================

const MAX_PROCESSES = 50;
const MIN_STEPS = 3;

/**
 * Detect execution processes in the code graph.
 *
 * Finds entry points (functions with no internal callers), performs BFS
 * from each one, and returns named processes with at least 3 steps.
 *
 * @param graph - KnowledgeGraph to analyze
 * @param options - Optional configuration
 * @returns Array of detected execution processes
 */
export function detectProcesses(
  graph: KnowledgeGraph,
  options?: {
    entryPoint?: string;
    minSteps?: number;
    maxProcesses?: number;
  },
): ExecutionProcess[] {
  const minSteps = options?.minSteps ?? MIN_STEPS;
  const maxProcesses = options?.maxProcesses ?? MAX_PROCESSES;

  // If a specific entry point is requested, just BFS from it
  if (options?.entryPoint) {
    const resolved = graph.findEntity(options.entryPoint);
    if (!resolved) {
      logger.debug(`ProcessDetector: entry point "${options.entryPoint}" not found`);
      return [];
    }

    const steps = bfsFromEntry(resolved, graph);
    if (steps.length < minSteps) return [];

    const files = [...new Set(steps.map(s => s.filePath))];
    return [{
      name: nameFromEntryPoint(resolved),
      entryPoint: resolved,
      steps,
      files,
    }];
  }

  // Collect all candidate entry points
  const allSubjects = new Set<string>();
  for (const t of graph.toJSON()) {
    // Only consider function-like entities
    if (t.subject.startsWith('fn:') || t.predicate === 'containsFunction') {
      if (t.predicate === 'containsFunction') {
        allSubjects.add(t.object);
      } else {
        allSubjects.add(t.subject);
      }
    }
  }

  // Also check subjects of 'calls' edges
  for (const t of graph.query({ predicate: 'calls' })) {
    allSubjects.add(t.subject);
    allSubjects.add(t.object);
  }

  // Score and rank candidates
  const scored: Array<{ symbol: string; score: number }> = [];
  for (const symbol of allSubjects) {
    const score = scoreEntryPoint(symbol, graph);
    if (score > 5) {
      scored.push({ symbol, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // BFS from top candidates
  const processes: ExecutionProcess[] = [];
  const usedSymbols = new Set<string>();

  for (const { symbol } of scored) {
    if (processes.length >= maxProcesses) break;
    if (usedSymbols.has(symbol)) continue;

    const steps = bfsFromEntry(symbol, graph);
    if (steps.length < minSteps) continue;

    const files = [...new Set(steps.map(s => s.filePath))];

    const process: ExecutionProcess = {
      name: nameFromEntryPoint(symbol),
      entryPoint: symbol,
      steps,
      files,
    };

    // Mark symbols as used
    for (const step of steps) {
      usedSymbols.add(step.symbolName);
    }

    processes.push(process);
  }

  // Deduplicate: remove processes that are subsets of larger ones
  const deduplicated: ExecutionProcess[] = [];
  for (const proc of processes) {
    const isSubset = processes.some(other =>
      other !== proc && isSubsetProcess(proc, other)
    );
    if (!isSubset) {
      deduplicated.push(proc);
    }
  }

  logger.debug(`ProcessDetector: found ${deduplicated.length} processes from ${scored.length} candidates`);
  return deduplicated.slice(0, maxProcesses);
}
