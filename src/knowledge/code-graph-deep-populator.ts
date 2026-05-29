/**
 * Code Graph Deep Populator
 *
 * Enriches the KnowledgeGraph with:
 *   - Class hierarchy (extends / implements)
 *   - Class → method containment
 *   - Function/method → function/method call edges
 *
 * Multi-language: delegates to per-language regex scanners.
 * Supported: TypeScript/JavaScript, Python, Go, Rust, Java.
 * Designed for on-demand use (deep: true), not at startup.
 * Performance target: <5s for ~1300 source files.
 */

import fs from 'fs';
import path from 'path';
import { KnowledgeGraph } from './knowledge-graph.js';
import { logger } from '../utils/logger.js';
import { getScannerForExt, getSupportedExtensions } from './scanners/index.js';
import type { SymbolDef, CallSite, InheritanceInfo } from './scanners/index.js';

// ============================================================================
// Constants
// ============================================================================

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', 'coverage', '.next', '__pycache__',
  'target', '.cache', '.codebuddy', '.turbo', 'vendor', 'venv', '.venv', 'out',
  'test', 'tests', '__tests__', '__mocks__', 'fixtures', 'e2e',
]);

const SOURCE_EXTS = getSupportedExtensions();

/** Max file size to scan (skip huge generated files) */
const MAX_FILE_SIZE = 200_000; // 200KB

/** Language-aware test file detection */
function isTestFile(name: string): boolean {
  // TS/JS: foo.test.ts, foo.spec.ts, foo._test.ts
  if (/\.(test|spec|_test)\./i.test(name)) return true;
  // Go: foo_test.go
  if (name.endsWith('_test.go')) return true;
  // Python: test_foo.py, foo_test.py
  if (name.endsWith('.py') && (name.startsWith('test_') || name.endsWith('_test.py'))) return true;
  // Rust: foo_test.rs (convention, though Rust uses inline #[cfg(test)])
  if (name.endsWith('_test.rs')) return true;
  // Java: FooTest.java, FooTests.java
  if (/Tests?\.java$/i.test(name)) return true;
  return false;
}

// ============================================================================
// Main entry point
// ============================================================================

/**
 * Deep-populate the code graph with class hierarchy and call graph.
 * Scans source files via per-language regex scanners — no AST parser dependency.
 *
 * @returns Number of triples added
 */
export function populateDeepCodeGraph(
  graph: KnowledgeGraph,
  cwd: string,
  srcDirs?: string[],
): number {
  const before = graph.getStats().tripleCount;
  const startTime = Date.now();

  // 1. Discover source files
  const dirs = srcDirs ?? detectSrcDirs(cwd);
  const files = walkSourceFiles(cwd, dirs);

  // 2. First pass: extract all symbol definitions via language-specific scanners
  const allSymbols: SymbolDef[] = [];
  const allCalls: CallSite[] = [];
  const allInheritance: InheritanceInfo[] = [];
  const symbolsByName = new Map<string, SymbolDef[]>();

  for (const file of files) {
    const content = readFileSafe(file.fullPath);
    if (!content) continue;

    const ext = path.extname(file.relPath).toLowerCase();
    const scanner = getScannerForExt(ext);
    if (!scanner) continue;

    const moduleId = file.relPath.replace(/\.[^.]+$/, '');
    const { symbols, calls, inheritance } = scanner.scanFile(content, moduleId);

    for (const sym of symbols) {
      allSymbols.push(sym);
      const list = symbolsByName.get(sym.name) ?? [];
      list.push(sym);
      symbolsByName.set(sym.name, list);
    }
    allCalls.push(...calls);
    allInheritance.push(...inheritance);
  }

  // 3. Populate class hierarchy + module → function containment
  for (const sym of allSymbols) {
    if (sym.kind === 'class') {
      graph.add(`cls:${sym.name}`, 'definedIn', `mod:${sym.module}`, {
        nodeType: 'class',
        line: String(sym.line),
      });
    }
    if (sym.kind === 'method' && sym.className) {
      const methodFqn = `fn:${sym.className}.${sym.name}`;
      const methodMeta: Record<string, string> = {
        nodeType: 'method',
        line: String(sym.line),
      };
      if (sym.params) methodMeta.params = sym.params;
      if (sym.returnType) methodMeta.returnType = sym.returnType;

      graph.add(`cls:${sym.className}`, 'hasMethod', methodFqn, methodMeta);
      graph.add(`mod:${sym.module}`, 'containsFunction', methodFqn, {
        ...methodMeta,
        className: sym.className,
      });
    }
    if (sym.kind === 'function') {
      const funcMeta: Record<string, string> = {
        nodeType: 'function',
        line: String(sym.line),
      };
      if (sym.params) funcMeta.params = sym.params;
      if (sym.returnType) funcMeta.returnType = sym.returnType;

      graph.add(`fn:${sym.name}`, 'definedIn', `mod:${sym.module}`, funcMeta);
      graph.add(`mod:${sym.module}`, 'containsFunction', `fn:${sym.name}`, funcMeta);
    }
  }

  // 4. Populate extends / implements from scanner-provided inheritance info
  for (const info of allInheritance) {
    if (info.extends) {
      graph.add(`cls:${info.className}`, 'extends', `cls:${info.extends}`);
    }
    if (info.implements) {
      for (const iface of info.implements) {
        graph.add(`cls:${info.className}`, 'implements', `iface:${iface}`);
      }
    }
  }

  // 5. Resolve and populate call edges
  for (const call of allCalls) {
    const calleeDefs = resolveCall(call, symbolsByName);
    for (const callee of calleeDefs) {
      const callerNode = call.callerFqn;
      const calleeNode = callee.kind === 'method' && callee.className
        ? `fn:${callee.className}.${callee.name}`
        : `fn:${callee.name}`;

      graph.add(callerNode, 'calls', calleeNode);
    }
  }

  // 6. Scan for dynamic imports: await import('./path') → add as import edges
  const DYNAMIC_IMPORT_RE = /await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const file of files) {
    const content = readFileSafe(file.fullPath);
    if (!content) continue;

    const moduleId = file.relPath.replace(/\.[^.]+$/, '');
    const sourceModule = `mod:${moduleId}`;

    let match: RegExpExecArray | null;
    DYNAMIC_IMPORT_RE.lastIndex = 0;
    while ((match = DYNAMIC_IMPORT_RE.exec(content)) !== null) {
      const importPath = match[1];
      if (importPath === undefined) continue;
      const targetModule = resolveDynamicImport(importPath, moduleId);
      if (targetModule) {
        graph.add(sourceModule, 'imports', `mod:${targetModule}`);
      }
    }
  }

  const elapsed = Date.now() - startTime;
  const added = graph.getStats().tripleCount - before;
  logger.debug(`CodeGraphDeep: added ${added} triples in ${elapsed}ms (${files.length} files, ${allSymbols.length} symbols, ${allCalls.length} call sites)`);
  return added;
}

// ============================================================================
// File scanning
// ============================================================================

interface FileEntry {
  relPath: string;
  fullPath: string;
}

function detectSrcDirs(cwd: string): string[] {
  const candidates = ['src', 'lib', 'app', 'server', 'client'];
  const found: string[] = [];
  for (const c of candidates) {
    try {
      if (fs.statSync(path.join(cwd, c)).isDirectory()) found.push(c);
    } catch { /* noop */ }
  }
  return found.length > 0 ? found : ['src'];
}

function walkSourceFiles(cwd: string, srcDirs: string[]): FileEntry[] {
  const entries: FileEntry[] = [];

  function walk(dir: string, depth: number): void {
    if (depth > 12) return;
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }

    for (const d of dirents) {
      if (d.isDirectory()) {
        if (!SKIP_DIRS.has(d.name) && !d.name.startsWith('.')) {
          walk(path.join(dir, d.name), depth + 1);
        }
        continue;
      }
      if (!d.isFile()) continue;
      const ext = path.extname(d.name).toLowerCase();
      if (!SOURCE_EXTS.has(ext)) continue;
      if (isTestFile(d.name)) continue;

      const fullPath = path.join(dir, d.name);
      try {
        if (fs.statSync(fullPath).size > MAX_FILE_SIZE) continue;
      } catch { continue; }

      const relPath = path.relative(cwd, fullPath).replace(/\\/g, '/');
      entries.push({ relPath, fullPath });
    }
  }

  for (const srcDir of srcDirs) {
    const abs = path.resolve(cwd, srcDir);
    if (fs.existsSync(abs)) walk(abs, 0);
  }

  return entries;
}

function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

// ============================================================================
// Call resolution
// ============================================================================

function resolveCall(
  call: CallSite,
  symbolsByName: Map<string, SymbolDef[]>,
): SymbolDef[] {
  const candidates = symbolsByName.get(call.calleeName);
  if (!candidates || candidates.length === 0) return [];

  // If it's a method call with a known receiver class, prefer that class's method
  if (call.isMethodCall && call.receiverClass) {
    const classMethod = candidates.find(
      c => c.kind === 'method' && c.className === call.receiverClass
    );
    if (classMethod) return [classMethod];
  }

  // For non-method calls, prefer functions over methods
  if (!call.isMethodCall) {
    const functions = candidates.filter(c => c.kind === 'function');
    if (functions.length === 1) return functions;
    if (functions.length > 1) {
      const first = functions[0];
      if (first !== undefined) return [first];
    }
  }

  // Fallback: return first candidate if unique
  if (candidates.length === 1) return candidates;

  return [];
}

// ============================================================================
// Dynamic import resolution
// ============================================================================

/**
 * Resolve a dynamic import path to a module ID.
 * Handles relative paths (./foo.js → dir/foo) and strips extensions.
 * Skips non-relative imports (npm packages).
 */
function resolveDynamicImport(importPath: string, sourceModule: string): string | null {
  // Only resolve relative imports
  if (!importPath.startsWith('.')) return null;

  // Strip .js/.ts/.mjs extensions
  const stripped = importPath.replace(/\.[cm]?[jt]sx?$/, '');

  // Resolve relative to source module's directory
  const sourceDir = sourceModule.includes('/')
    ? sourceModule.substring(0, sourceModule.lastIndexOf('/'))
    : '';

  // Simple path.join equivalent for forward-slash paths
  const parts = (sourceDir ? `${sourceDir}/${stripped}` : stripped).split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      resolved.pop();
    } else if (part !== '.') {
      resolved.push(part);
    }
  }

  return resolved.join('/');
}
