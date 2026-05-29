/**
 * Graph Updater — Incremental file re-scan
 *
 * When a file is edited, re-scans just that file and updates the graph:
 * 1. Remove all triples where the module is subject or object
 * 2. Re-scan the file with the appropriate language scanner
 * 3. Re-populate triples for that module
 *
 * Typical cost: ~1ms per file.
 */

import fs from 'fs';
import path from 'path';
import { KnowledgeGraph } from './knowledge-graph.js';
import { getScannerForExt } from './scanners/index.js';
import { logger } from '../utils/logger.js';

/**
 * Incrementally update the code graph for a single file.
 * @param filePath - Absolute path to the file that was modified
 * @param cwd - Project root directory
 * @returns Number of triples added (net of removed)
 */
export function updateGraphForFile(
  graph: KnowledgeGraph,
  filePath: string,
  cwd: string,
): number {
  const ext = path.extname(filePath).toLowerCase();
  const scanner = getScannerForExt(ext);
  if (!scanner) return 0;

  const relPath = path.relative(cwd, filePath).replace(/\\/g, '/');
  const moduleId = relPath.replace(/\.[^.]+$/, '');
  const modEntity = `mod:${moduleId}`;

  const beforeCount = graph.getStats().tripleCount;

  // 1. Collect all entities defined in this module BEFORE removing anything.
  // This is critical: we need entity IDs to clean up their call edges later.
  const entitiesInModule = new Set<string>();
  for (const t of graph.query({ predicate: 'definedIn', object: modEntity })) {
    entitiesInModule.add(t.subject);
  }
  for (const t of graph.query({ subject: modEntity, predicate: 'containsFunction' })) {
    entitiesInModule.add(t.object);
  }
  for (const t of graph.query({ subject: modEntity, predicate: 'hasMethod' })) {
    entitiesInModule.add(t.object);
  }

  // 2. Remove module-level triples
  graph.remove({ subject: modEntity });
  graph.remove({ object: modEntity });

  // 3. Remove all triples for entities that were defined in this module
  // (includes call edges FROM other modules TO these entities, and vice versa)
  for (const entity of entitiesInModule) {
    graph.remove({ subject: entity });
    graph.remove({ object: entity });
  }

  // 2. Re-scan the file
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    // File was deleted — just return the removal count
    const removed = beforeCount - graph.getStats().tripleCount;
    logger.debug(`GraphUpdater: removed ${removed} triples for deleted file ${relPath}`);
    return 0;
  }

  const { symbols, calls, inheritance } = scanner.scanFile(content, moduleId);

  // 3. Re-populate
  // Symbols
  for (const sym of symbols) {
    if (sym.kind === 'class') {
      graph.add(`cls:${sym.name}`, 'definedIn', modEntity, {
        nodeType: 'class',
        line: String(sym.line),
      });
    }
    if (sym.kind === 'method' && sym.className) {
      const methodFqn = `fn:${sym.className}.${sym.name}`;
      const meta: Record<string, string> = {
        nodeType: 'method',
        line: String(sym.line),
      };
      if (sym.params) meta.params = sym.params;
      if (sym.returnType) meta.returnType = sym.returnType;

      graph.add(`cls:${sym.className}`, 'hasMethod', methodFqn, meta);
      graph.add(modEntity, 'containsFunction', methodFqn, {
        ...meta,
        className: sym.className,
      });
    }
    if (sym.kind === 'function') {
      const meta: Record<string, string> = {
        nodeType: 'function',
        line: String(sym.line),
      };
      if (sym.params) meta.params = sym.params;
      if (sym.returnType) meta.returnType = sym.returnType;

      graph.add(`fn:${sym.name}`, 'definedIn', modEntity, meta);
      graph.add(modEntity, 'containsFunction', `fn:${sym.name}`, meta);
    }
  }

  // Inheritance
  for (const info of inheritance) {
    if (info.extends) {
      graph.add(`cls:${info.className}`, 'extends', `cls:${info.extends}`);
    }
    if (info.implements) {
      for (const iface of info.implements) {
        graph.add(`cls:${info.className}`, 'implements', `iface:${iface}`);
      }
    }
  }

  // Calls — build symbol map from current graph for resolution
  const symbolsByName = new Map<string, Array<{ name: string; kind: string; className?: string }>>();
  for (const sym of symbols) {
    const list = symbolsByName.get(sym.name) ?? [];
    list.push({ name: sym.name, kind: sym.kind, className: sym.className });
    symbolsByName.set(sym.name, list);
  }

  for (const call of calls) {
    const candidates = symbolsByName.get(call.calleeName);
    if (!candidates || candidates.length === 0) continue;

    if (call.isMethodCall && call.receiverClass) {
      const match = candidates.find(c => c.kind === 'method' && c.className === call.receiverClass);
      if (match) {
        graph.add(call.callerFqn, 'calls', `fn:${match.className}.${match.name}`);
        continue;
      }
    }
    if (!call.isMethodCall) {
      const funcs = candidates.filter(c => c.kind === 'function');
      const onlyFunc = funcs.length === 1 ? funcs[0] : undefined;
      if (onlyFunc) {
        graph.add(call.callerFqn, 'calls', `fn:${onlyFunc.name}`);
        continue;
      }
    }
    const c = candidates.length === 1 ? candidates[0] : undefined;
    if (c) {
      const target = c.kind === 'method' && c.className
        ? `fn:${c.className}.${c.name}`
        : `fn:${c.name}`;
      graph.add(call.callerFqn, 'calls', target);
    }
  }

  const added = graph.getStats().tripleCount - beforeCount;
  logger.debug(`GraphUpdater: updated ${relPath} (net ${added > 0 ? '+' : ''}${added} triples)`);
  return Math.max(added, 0);
}
