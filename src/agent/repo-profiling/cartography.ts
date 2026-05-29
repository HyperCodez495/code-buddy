/**
 * Deep Project Cartography
 *
 * Regex-based source scanning that builds a structural map of the project:
 * file stats, architecture layers, import graph, API surface, design patterns.
 *
 * Performance budget: <3 seconds for a 1200-file TypeScript project.
 * Strategy: single recursive walk, then parallel regex scanning with partial reads.
 *
 * V2: multi-root scanning, component inventory, Rust/Go/Python pattern detection.
 */

import fs from 'fs';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface CartographyResult {
  fileStats: FileStats;
  architecture: ArchitectureInfo;
  importGraph: ImportGraphInfo;
  apiSurface: ApiSurfaceInfo;
  patterns: DesignPatternInfo;
  /** V2: detailed component inventory with file paths and priorities */
  components?: ComponentInventory;
  /** V3: raw import edges [importer, imported] for code graph population */
  importEdges?: Array<[string, string]>;
}

export interface FileStats {
  byExtension: Record<string, number>;
  locEstimate: Record<string, number>;
  totalSourceFiles: number;
  totalTestFiles: number;
  largestFiles: Array<{ path: string; lines: number }>;
}

export interface ArchitectureInfo {
  layers: Array<{ name: string; directory: string; fileCount: number }>;
  style: string;
  maxDepth: number;
}

export interface ImportGraphInfo {
  hotModules: Array<{ module: string; importedBy: number }>;
  circularRisks: Array<{ a: string; b: string }>;
  orphanModules: string[];
}

export interface ApiSurfaceInfo {
  restRoutes: Array<{ method: string; path: string; file: string }>;
  wsEvents: string[];
  endpointCount: number;
}

export interface DesignPatternInfo {
  singletons: string[];
  registries: string[];
  factories: string[];
  facades: string[];
  middlewares: string[];
  observers: string[];
}

export interface ComponentEntry {
  name: string;
  file: string;
  priority?: number;
}

export interface ComponentInventory {
  /** Agent classes (class *Agent) */
  agents: ComponentEntry[];
  /** Tool classes (class *Tool) */
  tools: ComponentEntry[];
  /** Channel/Adapter classes (class *Channel or *Adapter) */
  channels: ComponentEntry[];
  /** Facades with file paths */
  facades: ComponentEntry[];
  /** Middlewares with file paths and extracted priorities */
  middlewares: ComponentEntry[];
  /** Key exported classes/functions per architecture layer (top 5 per module) */
  keyExports: Array<{ module: string; exports: string[] }>;
}

// ============================================================================
// Internal types
// ============================================================================

interface FileEntry {
  relPath: string;
  ext: string;
  size: number;
  isTest: boolean;
  fullPath: string;
}

// ============================================================================
// Constants
// ============================================================================

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', 'coverage', '.next', '__pycache__',
  'target', '.cache', '.codebuddy', '.turbo', '.nuxt', '.output', 'vendor',
  'venv', '.venv', 'out', '.parcel-cache',
]);

const SOURCE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.cs',
  '.rb', '.php', '.swift', '.kt', '.scala', '.vue', '.svelte',
]);

const BINARY_SKIP = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2',
  '.ttf', '.eot', '.mp3', '.mp4', '.wav', '.wasm', '.zip', '.tar',
  '.gz', '.pdf', '.lock', '.map',
]);

const AVG_BYTES_PER_LINE: Record<string, number> = {
  '.ts': 35, '.tsx': 35, '.js': 35, '.jsx': 35,
  '.py': 30, '.rs': 40, '.go': 35, '.java': 40,
  '.cs': 40, '.rb': 28, '.php': 35, '.vue': 30,
  '.kt': 38, '.swift': 38, '.scala': 38,
};

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.py': 'Python', '.rs': 'Rust', '.go': 'Go', '.java': 'Java',
  '.cs': 'C#', '.rb': 'Ruby', '.php': 'PHP', '.swift': 'Swift',
  '.kt': 'Kotlin', '.scala': 'Scala', '.vue': 'Vue', '.svelte': 'Svelte',
};

/** Generic Node.js/socket events to exclude from WS event detection */
const GENERIC_EVENTS = new Set([
  'close', 'connect', 'connection', 'data', 'drain', 'end', 'error',
  'finish', 'message', 'open', 'pause', 'readable', 'resume', 'timeout',
  'pong', 'ping', 'exit', 'spawn', 'disconnect', 'listening',
  // HTTP/server lifecycle events
  'start', 'stop', 'started', 'stopped', 'request', 'response',
  'all', 'ready', 'change', 'add', 'unlink', 'upgrade',
  'loopback', 'tailscale',
]);

/** Well-known source directory candidates for auto-detection */
const SOURCE_DIR_CANDIDATES = [
  'src', 'lib', 'app', 'server', 'client', 'backend', 'frontend',
  'src-tauri/src', 'src-tauri', 'src-electron',
  'core', 'internal', 'cmd', 'pkg',
];

/** Common directory roles for architecture layer detection */
const DIR_ROLES: Record<string, string> = {
  'agent': 'Agent core',
  'agents': 'Agents',
  'api': 'API layer',
  'auth': 'Authentication',
  'channels': 'Messaging channels',
  'cmd': 'CLI commands',
  'commands': 'Command handlers',
  'components': 'UI components',
  'config': 'Configuration',
  'context': 'Context management',
  'controllers': 'Controllers',
  'db': 'Database',
  'deploy': 'Deployment',
  'embeddings': 'Embeddings',
  'features': 'Feature flags',
  'gateway': 'Gateway',
  'hooks': 'Hooks',
  'i18n': 'Internationalization',
  'identity': 'Identity',
  'integrations': 'Integrations',
  'internal': 'Internal packages',
  'knowledge': 'Knowledge base',
  'mcp': 'MCP integration',
  'memory': 'Memory system',
  'middleware': 'Middleware',
  'models': 'Data models',
  'nodes': 'Device nodes',
  'observability': 'Observability',
  'pages': 'Pages',
  'personas': 'Personas',
  'pkg': 'Packages',
  'plugins': 'Plugin system',
  'prompts': 'Prompt engineering',
  'protocols': 'Protocols',
  'providers': 'Provider adapters',
  'routes': 'Routes',
  'sandbox': 'Sandbox',
  'search': 'Search engine',
  'security': 'Security',
  'server': 'HTTP server',
  'services': 'Services',
  'skills': 'Skills system',
  'store': 'State store',
  'streaming': 'Streaming',
  'tools': 'Tool implementations',
  'ui': 'UI layer',
  'utils': 'Utilities',
  'views': 'Views',
  'workflows': 'Workflows',
};

/** Max WS events to report (avoids noise on event-heavy projects) */
const MAX_WS_EVENTS = 30;

// ============================================================================
// Main entry point
// ============================================================================

/**
 * Run deep cartography scan on a project directory.
 * Designed to complete in <3 seconds for ~1200 source files.
 *
 * @param cwd - Project root directory
 * @param srcDir - Source directory or array of directories.
 *                 If omitted, auto-detects source roots.
 */
export function runCartography(cwd: string, srcDir?: string | string[]): CartographyResult {
  const srcDirs = normalizeSrcDirs(cwd, srcDir);
  if (srcDirs.length === 0) return emptyResult();

  // Phase 1: Walk all source + test directories
  const files = walkAllFiles(cwd, srcDirs);
  if (files.length === 0) return emptyResult();

  // Phase 2: File statistics (in-memory, no I/O)
  const fileStats = scanFileStats(files);

  // Phase 3: Architecture detection (in-memory)
  const architecture = scanArchitecture(files, srcDirs);

  // Phase 4: Combined scan — read each source file once, extract imports + patterns + API
  const { importGraph, patterns, apiSurface, components, importEdges } = scanCombined(files, cwd, srcDirs);

  return { fileStats, architecture, importGraph, apiSurface, patterns, components, importEdges };
}

// ============================================================================
// Source directory detection
// ============================================================================

function normalizeSrcDirs(cwd: string, srcDir?: string | string[]): string[] {
  if (Array.isArray(srcDir)) {
    return srcDir.filter((d) => fs.existsSync(path.join(cwd, d)));
  }
  if (typeof srcDir === 'string') {
    return fs.existsSync(path.join(cwd, srcDir)) ? [srcDir] : [];
  }
  return autoDetectSourceDirs(cwd);
}

/**
 * Auto-detect source directories by checking common candidates.
 * Also discovers monorepo packages (packages/star/src).
 */
function autoDetectSourceDirs(cwd: string): string[] {
  const found: string[] = [];

  // Check well-known candidates
  for (const candidate of SOURCE_DIR_CANDIDATES) {
    const candidatePath = path.join(cwd, candidate);
    try {
      if (fs.statSync(candidatePath).isDirectory()) {
        found.push(candidate);
      }
    } catch { /* doesn't exist */ }
  }

  // Monorepo: packages/*/src
  const packagesDir = path.join(cwd, 'packages');
  try {
    if (fs.statSync(packagesDir).isDirectory()) {
      for (const d of fs.readdirSync(packagesDir, { withFileTypes: true })) {
        if (d.isDirectory() && !d.name.startsWith('.')) {
          const pkgSrc = path.join('packages', d.name, 'src');
          if (fs.existsSync(path.join(cwd, pkgSrc))) {
            found.push(pkgSrc);
          }
        }
      }
    }
  } catch { /* no packages dir */ }

  // Fallback: if nothing found, use 'src'
  if (found.length === 0) {
    if (fs.existsSync(path.join(cwd, 'src'))) return ['src'];
    return [];
  }

  // Deduplicate (e.g., src-tauri and src-tauri/src both found → keep parent)
  return deduplicatePaths(found);
}

/** Remove child paths when parent is already included */
function deduplicatePaths(dirs: string[]): string[] {
  const sorted = [...dirs].sort();
  return sorted.filter((d, i) => {
    for (let j = 0; j < sorted.length; j++) {
      if (j !== i && d.startsWith(sorted[j] + '/')) return false;
    }
    return true;
  });
}

// ============================================================================
// Phase 1: File walker (multi-root)
// ============================================================================

function walkAllFiles(cwd: string, srcDirs: string[]): FileEntry[] {
  const entries: FileEntry[] = [];
  const walkedAbsPaths = new Set<string>();

  function walk(dir: string, depth: number): void {
    if (depth > 15) return;
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const d of dirents) {
      if (d.isDirectory()) {
        if (!SKIP_DIRS.has(d.name) && !d.name.startsWith('.')) {
          walk(path.join(dir, d.name), depth + 1);
        }
        continue;
      }

      if (!d.isFile()) continue;
      const ext = path.extname(d.name).toLowerCase();
      if (!SOURCE_EXTS.has(ext) || BINARY_SKIP.has(ext)) continue;

      const fullPath = path.join(dir, d.name);
      const relPath = path.relative(cwd, fullPath).replace(/\\/g, '/');
      let size = 0;
      try {
        size = fs.statSync(fullPath).size;
      } catch { /* skip */ }

      const isTest = /\.(test|spec|_test)\./i.test(d.name)
        || relPath.includes('/tests/')
        || relPath.includes('/test/')
        || relPath.includes('/__tests__/');

      entries.push({ relPath, ext, size, isTest, fullPath });
    }
  }

  function walkIfNew(dirPath: string): void {
    const abs = path.resolve(cwd, dirPath);
    if (walkedAbsPaths.has(abs)) return;
    if (!fs.existsSync(abs)) return;
    walkedAbsPaths.add(abs);
    walk(abs, 0);
  }

  // Walk all source directories
  for (const srcDir of srcDirs) {
    walkIfNew(srcDir);
  }

  // Walk test directories at root level
  for (const testDir of ['tests', 'test', '__tests__']) {
    walkIfNew(testDir);
  }

  return entries;
}

// ============================================================================
// Phase 2: File statistics
// ============================================================================

function scanFileStats(files: FileEntry[]): FileStats {
  const byExtension: Record<string, number> = {};
  const locEstimate: Record<string, number> = {};
  let totalSource = 0;
  let totalTest = 0;

  for (const f of files) {
    byExtension[f.ext] = (byExtension[f.ext] || 0) + 1;
    const lang = EXT_TO_LANG[f.ext] || f.ext;
    const bpl = AVG_BYTES_PER_LINE[f.ext] || 35;
    locEstimate[lang] = (locEstimate[lang] || 0) + Math.ceil(f.size / bpl);

    if (f.isTest) totalTest++;
    else totalSource++;
  }

  // Find largest files (top 10, count actual lines for those)
  const sorted = [...files].sort((a, b) => b.size - a.size).slice(0, 10);
  const largestFiles = sorted.map((f) => {
    let lines = Math.ceil(f.size / 35);
    try {
      const content = fs.readFileSync(f.fullPath, 'utf-8');
      lines = content.split('\n').length;
    } catch { /* estimate */ }
    return { path: f.relPath, lines };
  });

  return { byExtension, locEstimate, totalSourceFiles: totalSource, totalTestFiles: totalTest, largestFiles };
}

// ============================================================================
// Phase 3: Architecture detection (multi-root)
// ============================================================================

function scanArchitecture(files: FileEntry[], srcDirs: string[]): ArchitectureInfo {
  const dirCounts = new Map<string, number>();
  let maxDepth = 0;

  for (const f of files) {
    if (f.isTest) continue;

    // Find which srcDir this file belongs to
    const srcDir = srcDirs.find((d) => f.relPath.startsWith(d + '/'));
    if (!srcDir) continue;

    const rel = f.relPath.slice(srcDir.length + 1);
    const depth = rel.split('/').length;
    if (depth > maxDepth) maxDepth = depth;

    const firstDir = rel.split('/')[0];
    if (firstDir && firstDir !== rel) {
      const key = srcDir + '/' + firstDir;
      dirCounts.set(key, (dirCounts.get(key) || 0) + 1);
    }
  }

  const layers = [...dirCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([dirPath, count]) => {
      const lastSegment = dirPath.split('/').pop()!;
      return {
        name: DIR_ROLES[lastSegment] || lastSegment,
        directory: dirPath,
        fileCount: count,
      };
    });

  // Detect architectural style from all first-level dir names
  const allDirNames = new Set<string>();
  for (const key of dirCounts.keys()) {
    allDirNames.add(key.split('/').pop()!);
  }

  let style = 'modular';
  if (allDirNames.has('controllers') && allDirNames.has('models') && (allDirNames.has('routes') || allDirNames.has('views'))) {
    style = 'MVC';
  } else if (allDirNames.has('facades')) {
    style = 'facade';
  } else if (allDirNames.has('middleware') && allDirNames.has('agent')) {
    style = 'agentic pipeline';
  } else if (layers.length >= 10) {
    style = 'modular (large)';
  } else if (layers.length <= 3) {
    style = 'flat';
  }

  return { layers, style, maxDepth };
}

// ============================================================================
// Phase 4: Combined scan (imports + patterns + API in one pass)
// ============================================================================

// — JS/TS regexes —
const RE_IMPORT = /(?:^import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]|(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\))/gm;
const RE_ROUTE = /(?:router|app|server)\.(get|post|put|delete|patch|all|use|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
const RE_WS_EVENT = /\.on\s*\(\s*['"](\w[\w-]*)['"][,)]/g;
const RE_SINGLETON = /(?:private\s+static\s+_?instance|static\s+getInstance\s*\(|let\s+_\w*[Ii]nstance\s*(?::\s*\w+\s*(?:\|\s*null)?\s*)?=\s*null)/;
const RE_REGISTRY = /export\s+class\s+(\w*Registry)\b/;
const RE_FACTORY = /export\s+class\s+(\w*Factory)\b/;
const RE_FACADE = /export\s+class\s+(\w*Facade)\b/;
const RE_OBSERVER = /export\s+class\s+(\w+)\s+extends\s+EventEmitter\b/;
const RE_CLASS_NAME = /export\s+(?:default\s+)?class\s+(\w+)/;

// V2: component detection (JS/TS)
const RE_AGENT_CLASS = /export\s+(?:default\s+)?class\s+(\w*Agent)\b/;
const RE_TOOL_CLASS = /export\s+(?:default\s+)?class\s+(\w*Tool)\b/;
const RE_CHANNEL_CLASS = /export\s+(?:default\s+)?class\s+(\w*(?:Channel|Adapter))\b/;
const RE_MIDDLEWARE_PRIORITY = /priority\s*(?::\s*\w+\s*)?=\s*(\d+)/;
const RE_WS_EMIT = /\.emit\s*\(\s*['"](\w[\w:-]*)['"][,)]/g;
const RE_MSG_HANDLER = /case\s+['"](\w[\w_:-]*)['"]\s*:/g;
const RE_EXPORT = /export\s+(?:default\s+)?(?:class|function|const|async\s+function)\s+(\w+)/g;

// V2: Rust patterns
const RE_RUST_STRUCT = /pub\s+struct\s+(\w+)/g;
const RE_RUST_IMPL = /impl(?:<[^>]*>)?\s+(\w+)/g;
const RE_RUST_TRAIT = /pub\s+trait\s+(\w+)/g;
const RE_RUST_MOD = /pub\s+mod\s+(\w+)/;
const RE_RUST_USE = /use\s+(?:crate|super)::(\w+)/gm;

// V2: Python patterns
const RE_PY_CLASS = /class\s+(\w+)(?:\([^)]*\))?:/g;
const RE_PY_IMPORT = /(?:^from\s+(\S+)\s+import|^import\s+(\S+))/gm;
const RE_PY_DECORATOR = /@(app|router|blueprint)\.(get|post|put|delete|patch|route)\s*\(\s*['"]([^'"]+)['"]/g;

// V2: Go patterns
const RE_GO_STRUCT = /type\s+(\w+)\s+struct\b/g;
const RE_GO_INTERFACE = /type\s+(\w+)\s+interface\b/g;
const RE_GO_FUNC = /func\s+(?:\([^)]+\)\s+)?(\w+)/g;
const RE_GO_IMPORT = /import\s+(?:"([^"]+)"|\(([^)]+)\))/gm;

const HEAD_BYTES = 5120; // Read first 5KB for imports (covers ~150 lines)
const MAX_FILE_BYTES = 65536; // Cap file reads at 64KB

interface CombinedResult {
  importGraph: ImportGraphInfo;
  patterns: DesignPatternInfo;
  apiSurface: ApiSurfaceInfo;
  components: ComponentInventory;
  importEdges: Array<[string, string]>;
}

function scanCombined(files: FileEntry[], cwd: string, srcDirs: string[]): CombinedResult {
  // Import graph: module -> set of importers
  const importedBy = new Map<string, Set<string>>();
  const allModules = new Set<string>();

  // Patterns
  const singletons: string[] = [];
  const registries: string[] = [];
  const factories: string[] = [];
  const facades: string[] = [];
  const middlewares: string[] = [];
  const observers: string[] = [];

  // API surface
  const restRoutes: Array<{ method: string; path: string; file: string }> = [];
  const wsEventsSet = new Set<string>();

  // V2: Components
  const agents: ComponentEntry[] = [];
  const tools: ComponentEntry[] = [];
  const channels: ComponentEntry[] = [];
  const facadeEntries: ComponentEntry[] = [];
  const middlewareEntries: ComponentEntry[] = [];
  const moduleExports = new Map<string, Set<string>>();

  /** Check if a file belongs to any srcDir */
  const findSrcDir = (relPath: string): string | undefined =>
    srcDirs.find((d) => relPath.startsWith(d + '/'));

  for (const f of files) {
    if (f.isTest) continue;

    const srcDir = findSrcDir(f.relPath);

    // Normalize this module's identity (without extension)
    const moduleId = f.relPath.replace(/\.[^.]+$/, '');
    if (srcDir) allModules.add(moduleId);

    // Read file content (capped)
    let content: string;
    try {
      if (f.size > MAX_FILE_BYTES) {
        const buf = Buffer.alloc(MAX_FILE_BYTES);
        const fd = fs.openSync(f.fullPath, 'r');
        const bytesRead = fs.readSync(fd, buf, 0, MAX_FILE_BYTES, 0);
        fs.closeSync(fd);
        content = buf.toString('utf-8', 0, bytesRead);
      } else {
        content = fs.readFileSync(f.fullPath, 'utf-8');
      }
    } catch {
      continue;
    }

    const isJsTs = f.ext === '.ts' || f.ext === '.tsx' || f.ext === '.js' || f.ext === '.jsx';
    const isRust = f.ext === '.rs';
    const isPython = f.ext === '.py';
    const isGo = f.ext === '.go';

    // ── Imports ──
    const headContent = content.slice(0, HEAD_BYTES);

    if (isJsTs) {
      RE_IMPORT.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = RE_IMPORT.exec(headContent)) !== null) {
        const raw = m[1] || m[2];
        if (!raw || !raw.startsWith('.')) continue;
        const importerDir = path.dirname(f.relPath);
        let resolved = path.posix.join(importerDir, raw);
        resolved = resolved.replace(/\.(js|ts|tsx|jsx)$/, '');
        resolved = resolved.replace(/\/index$/, '');
        if (!importedBy.has(resolved)) importedBy.set(resolved, new Set());
        importedBy.get(resolved)!.add(moduleId);
      }
    } else if (isRust) {
      RE_RUST_USE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = RE_RUST_USE.exec(headContent)) !== null) {
        const modName = m[1];
        if (!modName) continue;
        if (!importedBy.has(modName)) importedBy.set(modName, new Set());
        importedBy.get(modName)!.add(moduleId);
      }
    } else if (isPython) {
      RE_PY_IMPORT.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = RE_PY_IMPORT.exec(headContent)) !== null) {
        const raw = m[1] || m[2];
        if (raw && raw.startsWith('.')) {
          const importerDir = path.dirname(f.relPath);
          const resolved = path.posix.join(importerDir, raw.replace(/^\.+/, ''));
          if (!importedBy.has(resolved)) importedBy.set(resolved, new Set());
          importedBy.get(resolved)!.add(moduleId);
        }
      }
    }
    // Go imports are mostly absolute (e.g., "github.com/..."), skip for import graph

    // Skip pattern/API scanning for non-src files
    if (!srcDir) continue;

    // ── Design patterns (JS/TS) ──
    if (isJsTs) {
      const className = RE_CLASS_NAME.exec(content)?.[1] || path.basename(f.relPath, f.ext);

      if (RE_SINGLETON.test(content)) singletons.push(className);

      const regMatch = RE_REGISTRY.exec(content);
      const regName = regMatch?.[1];
      if (regName) registries.push(regName);

      const factMatch = RE_FACTORY.exec(content);
      const factName = factMatch ? (factMatch[1] || factMatch[2]) : undefined;
      if (factName) factories.push(factName);

      const facadeMatch = RE_FACADE.exec(content);
      const facadeName = facadeMatch?.[1];
      if (facadeName) {
        facades.push(facadeName);
        facadeEntries.push({ name: facadeName, file: f.relPath });
      }

      const obsMatch = RE_OBSERVER.exec(content);
      const obsName = obsMatch?.[1];
      if (obsName) observers.push(obsName);

      if (f.relPath.includes('/middleware/') || f.relPath.includes('/middlewares/')) {
        middlewares.push(className);
        const baseName = path.basename(f.relPath, f.ext);
        if (baseName !== 'index' && baseName !== 'types' && baseName !== 'pipeline') {
          const prioMatch = RE_MIDDLEWARE_PRIORITY.exec(content);
          const prioStr = prioMatch?.[1];
          middlewareEntries.push({
            name: className,
            file: f.relPath,
            priority: prioStr !== undefined ? parseInt(prioStr, 10) : undefined,
          });
        }
      }

      // Agent classes
      if (f.relPath.includes('/specialized/') || f.relPath.includes('/agents/')) {
        const agentMatch = RE_AGENT_CLASS.exec(content);
        const agentName = agentMatch?.[1];
        if (agentName) agents.push({ name: agentName, file: f.relPath });
      }

      // Tool classes
      if (f.relPath.includes('/tools/') && !f.relPath.includes('/registry/') && !f.relPath.includes('/types')) {
        const toolMatch = RE_TOOL_CLASS.exec(content);
        const toolName = toolMatch?.[1];
        if (toolName) tools.push({ name: toolName, file: f.relPath });
      }

      // Channel classes
      if (f.relPath.includes('/channels/') && !f.relPath.includes('/pro/') && !f.relPath.includes('mock')) {
        const chanMatch = RE_CHANNEL_CLASS.exec(content);
        const chanName = chanMatch?.[1];
        if (chanName) channels.push({ name: chanName, file: f.relPath });
      }

      // Key exports
      const prefix = srcDir + '/';
      const modDir = f.relPath.startsWith(prefix) ? f.relPath.slice(prefix.length).split('/')[0] : null;
      if (modDir) {
        RE_EXPORT.lastIndex = 0;
        let expMatch: RegExpExecArray | null;
        while ((expMatch = RE_EXPORT.exec(content)) !== null) {
          const expName = expMatch[1];
          if (expName && expName.length > 2 && !expName.startsWith('_')) {
            if (!moduleExports.has(modDir)) moduleExports.set(modDir, new Set());
            moduleExports.get(modDir)!.add(expName);
          }
        }
      }
    }

    // ── Design patterns (Rust) ──
    if (isRust) {
      // Structs + traits as "key exports"
      const rustModule = path.basename(f.relPath, '.rs');
      const structs: string[] = [];
      RE_RUST_STRUCT.lastIndex = 0;
      let rm: RegExpExecArray | null;
      while ((rm = RE_RUST_STRUCT.exec(content)) !== null) { const s = rm[1]; if (s) structs.push(s); }
      RE_RUST_TRAIT.lastIndex = 0;
      while ((rm = RE_RUST_TRAIT.exec(content)) !== null) { const t = rm[1]; if (t) structs.push(t); }
      if (structs.length > 0) {
        const parent = path.dirname(f.relPath).split('/').pop() || rustModule;
        if (!moduleExports.has(parent)) moduleExports.set(parent, new Set());
        for (const s of structs) moduleExports.get(parent)!.add(s);
      }

      // Singleton pattern: static Lazy/OnceLock
      if (/static\s+\w+\s*:\s*(?:Lazy|OnceLock|Mutex)</.test(content)) {
        const name = RE_RUST_MOD.exec(content)?.[1] || rustModule;
        singletons.push(name);
      }
    }

    // ── Design patterns (Python) ──
    if (isPython) {
      RE_PY_CLASS.lastIndex = 0;
      let pm: RegExpExecArray | null;
      const pyClasses: string[] = [];
      while ((pm = RE_PY_CLASS.exec(content)) !== null) { const c = pm[1]; if (c) pyClasses.push(c); }
      if (pyClasses.length > 0) {
        const parent = path.dirname(f.relPath).split('/').pop() || path.basename(f.relPath, '.py');
        if (!moduleExports.has(parent)) moduleExports.set(parent, new Set());
        for (const c of pyClasses) moduleExports.get(parent)!.add(c);
      }

      // Python singletons: __instance, _instance pattern
      const firstPyClass = pyClasses[0];
      if (/_?_?instance\s*(?:=|:)/.test(content) && firstPyClass) {
        singletons.push(firstPyClass);
      }

      // Python REST routes (Flask/FastAPI)
      RE_PY_DECORATOR.lastIndex = 0;
      while ((pm = RE_PY_DECORATOR.exec(content)) !== null) {
        const method = pm[2];
        const routePath = pm[3];
        if (method === undefined || routePath === undefined) continue;
        restRoutes.push({ method: method.toUpperCase(), path: routePath, file: f.relPath });
      }
    }

    // ── Design patterns (Go) ──
    if (isGo) {
      const goStructs: string[] = [];
      RE_GO_STRUCT.lastIndex = 0;
      let gm: RegExpExecArray | null;
      while ((gm = RE_GO_STRUCT.exec(content)) !== null) { const s = gm[1]; if (s) goStructs.push(s); }
      RE_GO_INTERFACE.lastIndex = 0;
      while ((gm = RE_GO_INTERFACE.exec(content)) !== null) { const i = gm[1]; if (i) goStructs.push(i); }
      if (goStructs.length > 0) {
        const parent = path.dirname(f.relPath).split('/').pop() || path.basename(f.relPath, '.go');
        if (!moduleExports.has(parent)) moduleExports.set(parent, new Set());
        for (const s of goStructs) moduleExports.get(parent)!.add(s);
      }

      // Go singleton: sync.Once
      if (/sync\.Once/.test(content)) {
        singletons.push(goStructs[0] || path.basename(f.relPath, '.go'));
      }

      // Go HTTP routes (gin/echo/chi/net-http)
      const RE_GO_ROUTE = /\.(GET|POST|PUT|DELETE|PATCH|Handle|HandleFunc)\s*\(\s*"([^"]+)"/gi;
      RE_GO_ROUTE.lastIndex = 0;
      while ((gm = RE_GO_ROUTE.exec(content)) !== null) {
        const method = gm[1];
        const routePath = gm[2];
        if (method === undefined || routePath === undefined) continue;
        restRoutes.push({ method: method.toUpperCase(), path: routePath, file: f.relPath });
      }
    }

    // ── API surface (JS/TS: only in route-like files) ──
    if (isJsTs) {
      const isRouteFile = f.relPath.includes('/server/')
        || f.relPath.includes('/routes/')
        || f.relPath.includes('/api/')
        || f.relPath.includes('/gateway/');
      if (isRouteFile) {
        let m: RegExpExecArray | null;
        RE_ROUTE.lastIndex = 0;
        while ((m = RE_ROUTE.exec(content)) !== null) {
          const method = m[1];
          const routePath = m[2];
          if (method === undefined || routePath === undefined) continue;
          restRoutes.push({ method: method.toUpperCase(), path: routePath, file: f.relPath });
        }
        RE_WS_EVENT.lastIndex = 0;
        while ((m = RE_WS_EVENT.exec(content)) !== null) {
          const ev = m[1];
          if (ev && !GENERIC_EVENTS.has(ev)) wsEventsSet.add(ev);
        }
        RE_WS_EMIT.lastIndex = 0;
        while ((m = RE_WS_EMIT.exec(content)) !== null) {
          const ev = m[1];
          if (ev && !GENERIC_EVENTS.has(ev)) wsEventsSet.add(ev);
        }
        RE_MSG_HANDLER.lastIndex = 0;
        while ((m = RE_MSG_HANDLER.exec(content)) !== null) {
          const ev = m[1];
          if (ev && !GENERIC_EVENTS.has(ev) && ev.length > 2) wsEventsSet.add(ev);
        }
      }
    }
  }

  // ── Build import graph results ──
  const hotModules = [...importedBy.entries()]
    .map(([mod, importers]) => ({ module: mod, importedBy: importers.size }))
    .sort((a, b) => b.importedBy - a.importedBy)
    .slice(0, 15);

  // Circular dependency detection (A→B and B→A)
  const circularRisks: Array<{ a: string; b: string }> = [];
  const seen = new Set<string>();
  for (const [mod, importers] of importedBy) {
    for (const importer of importers) {
      const reverse = importedBy.get(importer);
      if (reverse?.has(mod)) {
        const key = [mod, importer].sort().join('↔');
        if (!seen.has(key)) {
          seen.add(key);
          circularRisks.push({ a: mod, b: importer });
          if (circularRisks.length >= 10) break;
        }
      }
    }
    if (circularRisks.length >= 10) break;
  }

  // Orphan modules (in src, not imported by anyone, not index files)
  const orphanModules = [...allModules]
    .filter((mod) => !importedBy.has(mod) && !mod.endsWith('/index') && !mod.endsWith('/types'))
    .slice(0, 15);

  // WS events — capped to avoid noise
  const wsEvents = [...wsEventsSet].sort().slice(0, MAX_WS_EVENTS);

  // V2: Build key exports (top 5 most significant per module)
  const keyExports: Array<{ module: string; exports: string[] }> = [];
  for (const [mod, exps] of moduleExports) {
    if (exps.size >= 3) {
      const sorted = [...exps]
        .filter((e) => !e.startsWith('DEFAULT_') && e.length > 3)
        .sort((a, b) => {
          // PascalCase classes first (but not ALL_CAPS constants)
          const aClass = /^[A-Z]/.test(a) && !/^[A-Z_]+$/.test(a) ? 1 : 0;
          const bClass = /^[A-Z]/.test(b) && !/^[A-Z_]+$/.test(b) ? 1 : 0;
          if (aClass !== bClass) return bClass - aClass;
          return b.length - a.length;
        });
      if (sorted.length >= 2) {
        keyExports.push({ module: mod, exports: sorted.slice(0, 5) });
      }
    }
  }
  keyExports.sort((a, b) => b.exports.length - a.exports.length);

  // Sort middleware by priority
  middlewareEntries.sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

  // Deduplicate by name (keep first occurrence)
  const dedup = <T extends { name: string }>(arr: T[]): T[] => {
    const namesSeen = new Set<string>();
    return arr.filter((item) => {
      if (namesSeen.has(item.name)) return false;
      namesSeen.add(item.name);
      return true;
    });
  };

  const components: ComponentInventory = {
    agents: dedup(agents).sort((a, b) => a.name.localeCompare(b.name)),
    tools: dedup(tools).sort((a, b) => a.name.localeCompare(b.name)),
    channels: dedup(channels).filter((c) => !c.name.startsWith('Mock') && !c.name.startsWith('Test')).sort((a, b) => a.name.localeCompare(b.name)),
    facades: dedup(facadeEntries).sort((a, b) => a.name.localeCompare(b.name)),
    middlewares: dedup(middlewareEntries),
    keyExports,
  };

  // V3: Flatten importedBy map into edge tuples [importer, imported]
  const importEdges: Array<[string, string]> = [];
  for (const [imported, importers] of importedBy) {
    for (const importer of importers) {
      importEdges.push([importer, imported]);
    }
  }

  return {
    importGraph: { hotModules, circularRisks, orphanModules },
    patterns: { singletons, registries, factories, facades, middlewares, observers },
    apiSurface: { restRoutes, wsEvents, endpointCount: restRoutes.length + wsEvents.length },
    components,
    importEdges,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function emptyResult(): CartographyResult {
  return {
    fileStats: { byExtension: {}, locEstimate: {}, totalSourceFiles: 0, totalTestFiles: 0, largestFiles: [] },
    architecture: { layers: [], style: 'unknown', maxDepth: 0 },
    importGraph: { hotModules: [], circularRisks: [], orphanModules: [] },
    apiSurface: { restRoutes: [], wsEvents: [], endpointCount: 0 },
    patterns: { singletons: [], registries: [], factories: [], facades: [], middlewares: [], observers: [] },
    components: { agents: [], tools: [], channels: [], facades: [], middlewares: [], keyExports: [] },
  };
}
