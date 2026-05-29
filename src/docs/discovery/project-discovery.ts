/**
 * Phase 1 — Project Discovery
 *
 * Analyzes the code graph to build a ProjectProfile without any
 * project-specific assumptions. Works on any codebase.
 */

import * as fs from 'fs';
import * as path from 'path';
import { KnowledgeGraph } from '../../knowledge/knowledge-graph.js';

// ============================================================================
// Types
// ============================================================================

export interface SourceFile {
  path: string;
  functions: string[];
  classes: string[];
  imports: string[];
  importedBy: string[];
  rank: number;
}

export interface RankedModule {
  path: string;
  rank: number;
  importers: number;
  functions: number;
  classes: number;
  description: string;
}

export interface ModuleCluster {
  id: number;
  label: string;
  members: string[];
  size: number;
  topModule: string;
}

export interface ArchitecturalLayer {
  name: string;
  directory: string;
  moduleCount: number;
  description: string;
}

export interface DetectedPattern {
  name: string;
  location: string;
  evidence: string;
}

export interface ProjectMetrics {
  totalModules: number;
  totalClasses: number;
  totalFunctions: number;
  totalRelationships: number;
  avgFunctionsPerModule: number;
  avgConnectionsPerModule: number;
}

export interface ProjectProfile {
  name: string;
  version: string;
  description: string;
  repoUrl: string;
  commit: string;
  language: string;
  framework?: string;

  metrics: ProjectMetrics;

  architecture: {
    type: 'monolith' | 'layered' | 'microservices' | 'plugin-based' | 'unknown';
    entryPoints: SourceFile[];
    coreModules: RankedModule[];
    clusters: ModuleCluster[];
    layers: ArchitecturalLayer[];
  };

  patterns: DetectedPattern[];

  /** Raw package.json scripts for getting-started */
  scripts: Record<string, string>;
  /** Dependency names */
  dependencies: string[];
  devDependencies: string[];
  /** Environment variables found */
  envVars: Array<{ name: string; desc: string }>;
  /** README/CLAUDE.md enriched context */
  readmeContext?: {
    problemStatement: string;
    features: string[];
    architectureOverview: string;
    /** Key subsystem table from CLAUDE.md */
    subsystemTable: string;
    /** Inspired-by / integration features (Native Engine, Codex, etc.) */
    inspiredFeatures: Array<{ name: string; source: string; location: string; description: string }>;
  };
  /** Extracted API surface (CLI commands + HTTP endpoints) */
  apiSurface?: {
    cliCommands: string[];
    httpEndpoints: Array<{ method: string; path: string }>;
  };
  /** Test patterns detected */
  testInfo?: {
    framework: string;
    totalFiles: number;
    byType: Record<string, number>;
  };
}

// ============================================================================
// Discovery
// ============================================================================

export async function discoverProject(
  graph: KnowledgeGraph,
  cwd: string,
  repoUrl: string = '',
  commit: string = '',
): Promise<ProjectProfile> {
  const pkg = readPkg(cwd);
  const allTriples = graph.toJSON();
  const stats = graph.getStats();

  // Collect entities by type
  const modules = new Set<string>();
  const classeSet = new Set<string>();
  const functionSet = new Set<string>();
  for (const t of allTriples) {
    if (t.subject.startsWith('mod:')) modules.add(t.subject);
    if (t.object.startsWith('mod:')) modules.add(t.object);
    if (t.subject.startsWith('cls:')) classeSet.add(t.subject);
    if (t.subject.startsWith('fn:')) functionSet.add(t.subject);
    if (t.object.startsWith('fn:')) functionSet.add(t.object);
  }

  // Detect source root and filter modules
  const srcRoot = detectSourceRoot(cwd, modules);
  const srcPrefix = srcRoot ? `mod:${srcRoot}/` : 'mod:';
  const srcModules = [...modules].filter(m => m.startsWith(srcPrefix));

  // Metrics
  const totalFunctions = [...new Set(allTriples.filter(t => t.predicate === 'containsFunction').map(t => t.object))].length;
  const totalClasses = [...new Set(allTriples.filter(t => t.predicate === 'containsClass').map(t => t.object))].length;
  const metrics: ProjectMetrics = {
    totalModules: srcModules.length,
    totalClasses: totalClasses,
    totalFunctions: totalFunctions,
    totalRelationships: stats.tripleCount,
    avgFunctionsPerModule: srcModules.length > 0 ? Math.round(totalFunctions / srcModules.length) : 0,
    avgConnectionsPerModule: srcModules.length > 0 ? Math.round(stats.tripleCount / srcModules.length) : 0,
  };

  // Core modules — top 20 by blended PageRank + function density
  const coreModules = srcModules
    .map(mod => {
      const modPath = mod.replace(/^mod:/, '');
      const fns = graph.query({ subject: mod, predicate: 'containsFunction' }).length;
      const cls = graph.query({ subject: mod, predicate: 'containsClass' }).length;
      const rank = graph.getEntityRank(mod);
      const importers = graph.query({ predicate: 'imports', object: mod }).length;
      return { path: modPath, rank, importers, functions: fns, classes: cls, description: '' };
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 20);

  // Entry points — modules with 0 importers (no one imports them)
  const entryPoints: SourceFile[] = srcModules
    .filter(mod => graph.query({ predicate: 'imports', object: mod }).length === 0)
    .slice(0, 10)
    .map(mod => moduleToSourceFile(graph, mod));

  // Detect layers from top-level directories
  const layers = detectLayers(srcModules, srcRoot);

  // Detect clusters via community detection
  let clusters: ModuleCluster[] = [];
  try {
    const { detectCommunities } = await import('../../knowledge/community-detection.js');
    const communities = detectCommunities(graph);
    clusters = [...communities.communityMembers.entries()]
      .filter(([, members]) => members.length >= 3)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 25)
      .map(([id, members]) => {
        const topMember = members.sort((a, b) => graph.getEntityRank(b) - graph.getEntityRank(a))[0];
        return {
          id,
          label: deriveClusterLabel(members),
          members: members.map(m => m.replace(/^mod:/, '')),
          size: members.length,
          topModule: topMember?.replace(/^mod:/, '') ?? '',
        };
      });
  } catch { /* community detection optional */ }

  // Detect architecture type
  const archType = detectArchitectureType(layers, coreModules, metrics);

  // Detect patterns
  const patterns = detectPatterns(graph, allTriples);

  // Detect framework
  const deps = Object.keys((pkg.dependencies ?? {}) as Record<string, string>);
  const devDeps = Object.keys((pkg.devDependencies ?? {}) as Record<string, string>);
  const framework = detectFramework(deps);

  // Detect language
  const language = detectLanguage(cwd);

  // Environment variables from CLAUDE.md or .env.example
  const envVars = extractEnvVars(cwd);

  return {
    name: (pkg.name as string) ?? path.basename(cwd),
    version: (pkg.version as string) ?? '0.0.0',
    description: (pkg.description as string) ?? '',
    repoUrl,
    commit,
    language,
    framework,
    metrics,
    architecture: {
      type: archType,
      entryPoints,
      coreModules,
      clusters,
      layers,
    },
    patterns,
    scripts: (pkg.scripts ?? {}) as Record<string, string>,
    dependencies: deps,
    devDependencies: devDeps,
    envVars,
    readmeContext: extractReadmeContext(cwd),
    apiSurface: extractAPISurface(cwd),
    testInfo: extractTestPatterns(cwd),
  };
}

// ============================================================================
// Helpers
// ============================================================================

function detectSourceRoot(cwd: string, modules: Set<string>): string {
  // Try tsconfig.json rootDir
  try {
    const tsconfig = JSON.parse(fs.readFileSync(path.join(cwd, 'tsconfig.json'), 'utf-8'));
    const rootDir = tsconfig.compilerOptions?.rootDir;
    if (rootDir) return rootDir.replace(/^\.\//, '').replace(/\/$/, '');
  } catch { /* no tsconfig */ }

  // Try pyproject.toml → src/
  if (fs.existsSync(path.join(cwd, 'pyproject.toml'))) return 'src';

  // Try Cargo.toml → src/
  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) return 'src';

  // Auto-detect: find the most common first directory among modules
  const dirCounts = new Map<string, number>();
  for (const mod of modules) {
    const parts = mod.replace(/^mod:/, '').split('/');
    const first = parts[0];
    if (parts.length >= 2 && first !== undefined) {
      dirCounts.set(first, (dirCounts.get(first) ?? 0) + 1);
    }
  }
  const sorted = [...dirCounts.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  if (top !== undefined && top[1] > modules.size * 0.5) return top[0];

  return 'src';
}

function readPkg(cwd: string): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8')); }
  catch { return {}; }
}

function moduleToSourceFile(graph: KnowledgeGraph, mod: string): SourceFile {
  return {
    path: mod.replace(/^mod:/, ''),
    functions: graph.query({ subject: mod, predicate: 'containsFunction' }).map(t => t.object.replace(/^fn:/, '')),
    classes: graph.query({ subject: mod, predicate: 'containsClass' }).map(t => t.object.replace(/^cls:/, '')),
    imports: graph.query({ subject: mod, predicate: 'imports' }).map(t => t.object.replace(/^mod:/, '')),
    importedBy: graph.query({ predicate: 'imports', object: mod }).map(t => t.subject.replace(/^mod:/, '')),
    rank: graph.getEntityRank(mod),
  };
}

function detectLayers(modules: string[], srcRoot: string): ArchitecturalLayer[] {
  const prefix = srcRoot ? `mod:${srcRoot}/` : 'mod:';
  const dirCounts = new Map<string, number>();
  for (const mod of modules) {
    const stripped = mod.startsWith(prefix) ? mod.slice(prefix.length) : mod.replace(/^mod:/, '');
    const dir = stripped.split('/')[0];
    if (dir) dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
  }

  return [...dirCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([name, count]) => ({
      name,
      directory: srcRoot ? `${srcRoot}/${name}` : name,
      moduleCount: count,
      description: '',
    }));
}

function deriveClusterLabel(members: string[]): string {
  const dirCounts = new Map<string, number>();
  for (const m of members) {
    // Strip mod: prefix and first directory (source root) to get subsystem name
    const parts = m.replace(/^mod:/, '').split('/');
    const dir = (parts.length > 1 ? parts[1] : parts[0]) ?? 'misc';
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
  }
  const sorted = [...dirCounts.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  if (top === undefined) return 'misc';
  if (top[1] / members.length > 0.6) return top[0];
  return sorted.slice(0, 2).map(([d]) => d).join(' + ');
}

function detectArchitectureType(
  layers: ArchitecturalLayer[],
  coreModules: RankedModule[],
  metrics: ProjectMetrics,
): 'monolith' | 'layered' | 'microservices' | 'plugin-based' | 'unknown' {
  // Plugin-based: has a plugins directory
  if (layers.some(l => l.name === 'plugins' || l.name === 'extensions')) return 'plugin-based';
  // Microservices: multiple independent entry points + low coupling
  if (layers.filter(l => l.name.includes('service')).length >= 3) return 'microservices';
  // Layered: distinct layers with clear hierarchy
  if (layers.length >= 5 && metrics.totalModules > 50) return 'layered';
  // Small project
  if (metrics.totalModules < 20) return 'monolith';
  return 'unknown';
}

function detectPatterns(graph: KnowledgeGraph, triples: Array<{ subject: string; predicate: string; object: string }>): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  // Facade: class with high importers + many outgoing calls
  const classImporters = new Map<string, number>();
  for (const t of triples) {
    if (t.predicate === 'imports' && t.object.startsWith('cls:')) {
      classImporters.set(t.object, (classImporters.get(t.object) ?? 0) + 1);
    }
  }
  for (const [cls, count] of classImporters) {
    if (count >= 5) {
      patterns.push({ name: 'Facade', location: cls.replace(/^cls:/, ''), evidence: `${count} importers` });
    }
  }

  // Singleton: classes with getInstance
  for (const t of triples) {
    if (t.predicate === 'containsFunction' && t.object.includes('.getInstance')) {
      patterns.push({ name: 'Singleton', location: t.subject.replace(/^mod:/, ''), evidence: 'getInstance() method' });
    }
  }

  // Registry: classes with register/unregister
  for (const t of triples) {
    if (t.predicate === 'containsFunction' && (t.object.includes('.register') || t.object.includes('Registry'))) {
      patterns.push({ name: 'Registry', location: t.subject.replace(/^mod:/, ''), evidence: 'register() or Registry class' });
    }
  }

  return patterns.slice(0, 20);
}

function detectFramework(deps: string[]): string | undefined {
  if (deps.includes('next')) return 'nextjs';
  if (deps.includes('express')) return 'express';
  if (deps.includes('@nestjs/core')) return 'nestjs';
  if (deps.includes('fastify')) return 'fastify';
  if (deps.includes('react') && !deps.includes('ink')) return 'react';
  if (deps.includes('vue')) return 'vue';
  if (deps.includes('angular')) return 'angular';
  if (deps.includes('django')) return 'django';
  if (deps.includes('flask')) return 'flask';
  if (deps.includes('ink')) return 'ink';
  return undefined;
}

function detectLanguage(cwd: string): string {
  if (fs.existsSync(path.join(cwd, 'tsconfig.json'))) return 'typescript';
  if (fs.existsSync(path.join(cwd, 'package.json'))) return 'javascript';
  if (fs.existsSync(path.join(cwd, 'pyproject.toml')) || fs.existsSync(path.join(cwd, 'setup.py'))) return 'python';
  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) return 'rust';
  if (fs.existsSync(path.join(cwd, 'go.mod'))) return 'go';
  if (fs.existsSync(path.join(cwd, 'pom.xml'))) return 'java';
  return 'unknown';
}

function extractReadmeContext(cwd: string): ProjectProfile['readmeContext'] {
  const result = {
    problemStatement: '',
    features: [] as string[],
    architectureOverview: '',
    subsystemTable: '',
    inspiredFeatures: [] as Array<{ name: string; source: string; location: string; description: string }>,
  };

  // Read README.md first 3KB
  try {
    const readme = fs.readFileSync(path.join(cwd, 'README.md'), 'utf-8').substring(0, 3000);
    // Extract first non-heading paragraph as problem statement
    const firstPara = readme.match(/^(?!#|\s*$)(.+(?:\n(?!#|\s*$).+)*)/m);
    if (firstPara?.[1]) result.problemStatement = firstPara[1].trim().substring(0, 300);
    // Extract feature list items
    for (const m of readme.matchAll(/^[-*]\s+\*?\*?(.+?)\*?\*?\s*(?:[—–-].+)?$/gm)) {
      const feature = m[1];
      if (feature === undefined) continue;
      result.features.push(feature.trim());
      if (result.features.length >= 20) break;
    }
  } catch { /* no README */ }

  // Read CLAUDE.md — full file for comprehensive extraction
  try {
    const claude = fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf-8');

    // Extract architecture overview section
    const archMatch = claude.match(/## Architecture[^\n]*\n([\s\S]*?)(?=\n## [^#])/);
    if (archMatch?.[1]) result.architectureOverview = archMatch[1].trim().substring(0, 1500);

    // Extract key subsystem table (### Key Subsystems Quick Reference)
    const tableMatch = claude.match(/### Key Subsystems Quick Reference\n([\s\S]*?)(?=\n###|\n## [^#])/);
    if (tableMatch?.[1]) {
      result.subsystemTable = tableMatch[1].trim().substring(0, 4000);
    } else {
      // Fallback: any subsystem/location/notes table
      const fallback = claude.match(/\| Subsystem \| Location \| Notes \|[\s\S]*?(?=\n\n)/);
      if (fallback) result.subsystemTable = fallback[0].substring(0, 4000);
    }

    // Extract inspired-by features (Native Engine, Codex, Manus, etc.)
    // Pattern: "### Feature Name (Source-inspired)" or "Feature (Source-inspired)" in h3/h4
    for (const m of claude.matchAll(/### (.+?)\s*\((\w[\w\s]*?)-inspired\)\s*\n([\s\S]*?)(?=\n###|\n## [^#])/g)) {
      const rawName = m[1];
      const rawSource = m[2];
      const body = m[3];
      if (rawName === undefined || rawSource === undefined || body === undefined) continue;
      const name = rawName.trim();
      const source = rawSource.trim();
      // Extract location from backtick paths in the description
      const locMatch = body.match(/`(src\/[^`]+)`/);
      const location = locMatch?.[1] ?? '';
      // First meaningful line as description
      const descLine = body.split('\n').find(l => l.trim() && !l.startsWith('|') && !l.startsWith('`'));
      result.inspiredFeatures.push({
        name,
        source,
        location,
        description: descLine?.trim().substring(0, 200) ?? '',
      });
    }

    // Capture "### OpenManus/Native Engine Section (paths)" headings
    for (const m of claude.matchAll(/### ((?:OpenManus|Native Engine)[^(\n]*)\s*(?:\(([^)]*)\))?\s*\n([\s\S]*?)(?=\n###|\n## [^#])/g)) {
      const rawName = m[1];
      const body = m[3];
      if (rawName === undefined || body === undefined) continue;
      const name = rawName.trim();
      const location = m[2]?.replace(/`/g, '').split(',')[0]?.trim() ?? '';
      const descLine = body.split('\n').find(l => l.trim() && !l.startsWith('|') && !l.startsWith('`') && !l.startsWith('```'));
      if (!result.inspiredFeatures.some(f => f.name === name)) {
        result.inspiredFeatures.push({
          name,
          source: name.includes('OpenManus') ? 'OpenManus' : 'Native Engine',
          location,
          description: descLine?.trim().substring(0, 200) ?? '',
        });
      }
    }

    // Scan subsystem table rows mentioning Native Engine/Codex/OpenManus
    for (const m of claude.matchAll(/\| ([^|]+?) \| `([^`]+)` \|([^|]*(?:Native Engine|Codex|Manus|OpenManus)[^|]*)\|/g)) {
      const rawName = m[1];
      const rawLocation = m[2];
      const rawDesc = m[3];
      if (rawName === undefined || rawLocation === undefined || rawDesc === undefined) continue;
      const name = rawName.trim();
      const location = rawLocation.trim();
      const desc = rawDesc.trim();
      if (!result.inspiredFeatures.some(f => f.name === name)) {
        const source = /OpenManus/i.test(desc) ? 'OpenManus' : /Native Engine/i.test(desc) ? 'Native Engine' : 'Codex';
        result.inspiredFeatures.push({ name, source, location, description: desc.substring(0, 200) });
      }
    }

    // Scan for "# commands (Native Engine parity)" style sections
    for (const m of claude.matchAll(/# .+?\(Native Engine[^)]*\)\s*\n([\s\S]*?)(?=\n#[^#])/g)) {
      const section = m[1];
      if (section === undefined) continue;
      const commands = [...section.matchAll(/^(?:buddy|\/)\s+(.+)$/gm)]
        .map(c => c[1]?.trim())
        .filter((c): c is string => c !== undefined);
      if (commands.length > 0 && !result.inspiredFeatures.some(f => f.name === 'Native Engine CLI Commands')) {
        result.inspiredFeatures.push({
          name: 'Native Engine CLI Commands',
          source: 'Native Engine',
          location: 'src/commands/',
          description: `${commands.length} commands: ${commands.slice(0, 8).join(', ')}`,
        });
      }
    }
  } catch { /* no CLAUDE.md */ }

  return result;
}

function extractAPISurface(cwd: string): ProjectProfile['apiSurface'] {
  const result = { cliCommands: [] as string[], httpEndpoints: [] as Array<{ method: string; path: string }> };

  // CLI: scan entry point for commander .command() calls
  const entryFiles = ['src/index.ts', 'src/index.js', 'src/cli.ts', 'src/cli.js'];
  for (const entry of entryFiles) {
    try {
      const content = fs.readFileSync(path.join(cwd, entry), 'utf-8');
      for (const m of content.matchAll(/\.command\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
        if (m[1] !== undefined) result.cliCommands.push(m[1]);
      }
      if (result.cliCommands.length > 0) break;
    } catch { /* file not found */ }
  }

  // HTTP: scan route directories for .get(/.post( patterns
  const routeDirs = ['src/server/routes', 'src/routes', 'src/api', 'routes', 'src/server'];
  for (const dir of routeDirs) {
    const fullDir = path.join(cwd, dir);
    try {
      if (!fs.existsSync(fullDir) || !fs.statSync(fullDir).isDirectory()) continue;
      const files = fs.readdirSync(fullDir).filter(f => /\.(ts|js)$/.test(f)).slice(0, 15);
      for (const file of files) {
        const content = fs.readFileSync(path.join(fullDir, file), 'utf-8');
        for (const m of content.matchAll(/\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi)) {
          const method = m[1];
          const routePath = m[2];
          if (method === undefined || routePath === undefined) continue;
          result.httpEndpoints.push({ method: method.toUpperCase(), path: routePath });
        }
      }
    } catch { /* can't read route dir */ }
  }

  return result;
}

function extractTestPatterns(cwd: string): ProjectProfile['testInfo'] {
  const result = { framework: 'unknown' as string, totalFiles: 0, byType: {} as Record<string, number> };

  // Detect framework from config files
  const frameworkDetectors: Array<{ files: string[]; name: string }> = [
    { files: ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts'], name: 'vitest' },
    { files: ['jest.config.ts', 'jest.config.js', 'jest.config.json'], name: 'jest' },
    { files: ['pytest.ini', 'conftest.py'], name: 'pytest' },
    { files: ['.mocharc.yml', '.mocharc.json'], name: 'mocha' },
  ];
  for (const { files, name } of frameworkDetectors) {
    if (files.some(f => fs.existsSync(path.join(cwd, f)))) {
      result.framework = name;
      break;
    }
  }

  // Scan test directories (1 level deep)
  const testPattern = /\.(test|spec)\.(ts|js|tsx|jsx|py)$/;
  const testRoots = ['tests', 'test', '__tests__', 'spec'];
  for (const root of testRoots) {
    const rootPath = path.join(cwd, root);
    try {
      if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) continue;
      const entries = fs.readdirSync(rootPath, { withFileTypes: true });

      // Test files at root level
      const rootTests = entries.filter(e => e.isFile() && testPattern.test(e.name));
      if (rootTests.length > 0) {
        result.byType['other'] = (result.byType['other'] ?? 0) + rootTests.length;
        result.totalFiles += rootTests.length;
      }

      // Subdirectories (unit, integration, e2e, etc.)
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const type = entry.name;
        try {
          const subFiles = fs.readdirSync(path.join(rootPath, entry.name))
            .filter(f => testPattern.test(f));
          if (subFiles.length > 0) {
            result.byType[type] = (result.byType[type] ?? 0) + subFiles.length;
            result.totalFiles += subFiles.length;
          }
        } catch { /* can't read subdir */ }
      }
    } catch { /* can't read test root */ }
  }

  return result;
}

function extractEnvVars(cwd: string): Array<{ name: string; desc: string }> {
  const vars: Array<{ name: string; desc: string }> = [];

  // Try CLAUDE.md
  try {
    const claudeMd = fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf-8').substring(0, 35000);
    for (const m of claudeMd.matchAll(/\|\s*`([A-Z][A-Z0-9_]+)`\s*\|\s*([^|]+)\s*\|/g)) {
      if (m[1] && m[2] && !m[1].startsWith('Variable') && !m[1].startsWith('Metric')) {
        vars.push({ name: m[1], desc: m[2].trim() });
      }
    }
  } catch { /* no CLAUDE.md */ }

  // Try README.md (same table format)
  if (vars.length === 0) {
    try {
      const readme = fs.readFileSync(path.join(cwd, 'README.md'), 'utf-8').substring(0, 35000);
      for (const m of readme.matchAll(/\|\s*`([A-Z][A-Z0-9_]+)`\s*\|\s*([^|]+)\s*\|/g)) {
        if (m[1] && m[2] && !m[1].startsWith('Variable') && !m[1].startsWith('Metric')) {
          vars.push({ name: m[1], desc: m[2].trim() });
        }
      }
    } catch { /* no README.md */ }
  }

  // Try .env.example
  if (vars.length === 0) {
    try {
      const envExample = fs.readFileSync(path.join(cwd, '.env.example'), 'utf-8');
      for (const line of envExample.split('\n')) {
        const match = line.match(/^([A-Z][A-Z0-9_]+)\s*=/);
        if (match?.[1]) vars.push({ name: match[1], desc: '' });
      }
    } catch { /* no .env.example */ }
  }

  return vars;
}
