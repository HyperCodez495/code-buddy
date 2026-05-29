/**
 * Directory structure profiling: top-level dirs, src/ subdirs, .NET solution dirs.
 */

import fs from 'fs';
import path from 'path';
import type { ProfilingContext } from '../types.js';
import type { FsHelpers } from '../fs-helpers.js';

const DIR_ROLES: Record<string, string> = {
  src: 'Source code', lib: 'Library code', app: 'Application code',
  tests: 'Tests', test: 'Tests', __tests__: 'Tests', spec: 'Tests',
  docs: 'Documentation', doc: 'Documentation',
  scripts: 'Scripts', tools: 'Build tools',
  config: 'Configuration', configs: 'Configuration',
  public: 'Static assets', static: 'Static assets', assets: 'Assets',
  migrations: 'Database migrations',
  packages: 'Monorepo packages', apps: 'Monorepo apps',
};

const IGNORED_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage', 'out', 'output',
  '.git', '.svn', '.hg', '__pycache__', '.tox', '.mypy_cache',
  'vendor', 'target',
]);

const SRC_DIR_ROLES: Record<string, string> = {
  agent: 'Agent core', agents: 'Agent implementations',
  api: 'API layer', app: 'Application entry',
  auth: 'Authentication', automation: 'Automation',
  cache: 'Caching layer',
  channels: 'Messaging channels',
  cli: 'CLI interface', commands: 'Command handlers',
  components: 'UI components',
  config: 'Configuration', context: 'Context management',
  controllers: 'Controllers',
  'Controllers': 'Controllers',
  daemon: 'Background daemon',
  data: 'Data access layer', 'Data': 'Data access layer',
  db: 'Database layer', database: 'Database layer',
  dtos: 'Data transfer objects', 'DTOs': 'Data transfer objects',
  deploy: 'Deployment',
  'desktop-automation': 'Desktop automation',
  embeddings: 'Embeddings / vectors',
  events: 'Event system',
  features: 'Feature modules',
  gateway: 'Gateway / WebSocket',
  hooks: 'Hooks',
  i18n: 'Internationalization',
  identity: 'Identity management',
  integrations: 'External integrations',
  input: 'Input handling',
  knowledge: 'Knowledge system',
  lib: 'Shared library code',
  mcp: 'MCP integration', memory: 'Memory system',
  middleware: 'Middleware',
  'Migrations': 'Database migrations',
  models: 'Data models', 'Models': 'Data models',
  'ViewModels': 'View models',
  nodes: 'Node/device management',
  observability: 'Observability / tracing',
  pages: 'Pages / routes',
  personas: 'Persona system',
  analytics: 'Analytics / metrics',
  plugins: 'Plugin system',
  protocols: 'Protocols',
  renderers: 'Output renderers',
  providers: 'Provider adapters',
  routes: 'HTTP routes',
  sandbox: 'Sandbox / isolation',
  search: 'Search engine',
  security: 'Security layer',
  server: 'HTTP server',
  services: 'Service layer', 'Services': 'Service layer',
  'Repositories': 'Repository layer',
  'Interfaces': 'Interface definitions',
  'Extensions': 'Extension methods',
  'Hubs': 'SignalR hubs',
  skills: 'Skills system',
  store: 'State store', streaming: 'Streaming',
  styles: 'Stylesheets',
  tasks: 'Task management',
  tools: 'Tool implementations',
  types: 'Type definitions',
  ui: 'UI layer',
  utils: 'Utilities',
  views: 'Views', 'Views': 'Views',
  viewmodels: 'View models',
  converters: 'Value converters', 'Converters': 'Value converters',
  behaviors: 'Behaviors', 'Behaviors': 'Behaviors',
  themes: 'Themes / styles', 'Themes': 'Themes / styles',
  'Styles': 'Styles',
  'Assets': 'Assets / resources',
  'Controls': 'Custom controls',
  'Dialogs': 'Dialog windows',
  'Navigation': 'Navigation',
  voice: 'Voice / TTS', 'talk-mode': 'Voice / TTS',
  workers: 'Background workers',
  workflows: 'Workflow engine',
  management: 'Management commands',
  templatetags: 'Template tags',
  fixtures: 'Test fixtures',
  serializers: 'Serializers',
  signals: 'Signal handlers',
  celery: 'Task queue',
  schemas: 'Schemas / validation',
  handlers: 'Request handlers',
  extractors: 'Extractors',
};

const MAX_SRC_DIRS = 20;

/**
 * Detect common directories (src, tests, docs).
 */
export function profileCommonDirs(ctx: ProfilingContext, fsh: FsHelpers): void {
  for (const candidate of ['src', 'lib', 'app']) {
    if (fsh.exists(path.join(ctx.cwd, candidate))) {
      ctx.directories.src = candidate;
      break;
    }
  }
  for (const candidate of ['tests', 'test', '__tests__', 'spec']) {
    if (fsh.exists(path.join(ctx.cwd, candidate))) {
      ctx.directories.tests = candidate;
      break;
    }
  }
  for (const candidate of ['docs', 'documentation', 'doc']) {
    if (fsh.exists(path.join(ctx.cwd, candidate))) {
      ctx.directories.docs = candidate;
      break;
    }
  }
}

/**
 * Profile top-level directories with role mapping.
 */
export function profileTopLevelDirs(ctx: ProfilingContext): void {
  try {
    const entries = fs.readdirSync(ctx.cwd, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name.startsWith('.')) continue;
      if (IGNORED_DIRS.has(name)) continue;
      if (/^tmp|^temp|_tmp|_temp|_test$|_repro|burnin/i.test(name)) continue;
      if (/^[A-Z]:?[A-Za-z]/.test(name) || name.length > 40) continue;
      const role = DIR_ROLES[name] || undefined;
      if (role) {
        ctx.topLevelDirs.push({ name, role });
      }
    }
  } catch { /* ignore */ }
}

/**
 * Scan src/ subdirectories for architecture insight.
 */
export function profileSrcSubdirs(ctx: ProfilingContext): void {
  const srcPath = path.join(ctx.cwd, ctx.directories.src || 'src');
  if (!fs.existsSync(srcPath)) return;

  try {
    const entries = fs.readdirSync(srcPath, { withFileTypes: true });
    const known: Array<{ name: string; role: string }> = [];
    const unknown: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const role = SRC_DIR_ROLES[entry.name];
      if (role) {
        known.push({ name: entry.name, role });
      } else {
        unknown.push(entry.name);
      }
    }
    // Sort all dirs by file count (largest first)
    const countFiles = (name: string) => {
      try { return fs.readdirSync(path.join(srcPath, name)).length; } catch { return 0; }
    };
    const allDirs = [
      ...known.map(k => ({ ...k, count: countFiles(k.name) })),
      ...unknown.map(name => ({ name, role: 'Module', count: countFiles(name) })),
    ].sort((a, b) => b.count - a.count);
    for (const { name, role } of allDirs.slice(0, MAX_SRC_DIRS)) {
      ctx.srcSubdirs.push({ name, role });
    }
  } catch { /* ignore */ }
}

/**
 * .NET solution project directories (when no src/ exists).
 */
export function profileDotnetSolutionDirs(ctx: ProfilingContext, fsh: FsHelpers): void {
  const allCsproj = ctx.allCsproj || [];
  const slnFiles = ctx.slnFiles || [];
  const deepCsproj = allCsproj.filter(f => f.includes(path.sep) || f.includes('/'));

  if (!ctx.languages.includes('C#') || ctx.srcSubdirs.length > 0 || deepCsproj.length === 0) return;

  for (const csproj of deepCsproj) {
    const dirName = path.dirname(csproj);
    if (dirName !== '.') {
      const projName = dirName.toLowerCase();
      let role = 'Project';
      if (projName.endsWith('.desktop')) role = 'Desktop platform';
      else if (projName.endsWith('.browser') || projName.endsWith('.wasm')) role = 'Browser platform';
      else if (projName.endsWith('.ios')) role = 'iOS platform';
      else if (projName.endsWith('.android') || projName.endsWith('.droid')) role = 'Android platform';
      else if (projName.includes('test') || projName.includes('spec')) role = 'Tests';
      else if (projName.includes('.api') || projName.includes('.web')) role = 'Web API';
      else if (projName.includes('core') || projName.includes('domain')) role = 'Domain / Core';
      else if (projName.includes('infra') || projName.includes('data') || projName.includes('persistence')) role = 'Infrastructure / Data';
      else if (projName.includes('shared') || projName.includes('common')) role = 'Shared library';
      else if (projName.includes('worker')) role = 'Background service';
      else if (projName.includes('client') || projName.includes('blazor')) role = 'Client / UI';
      else if (slnFiles[0] !== undefined && slnFiles[0].replace('.sln', '').toLowerCase() === projName) role = 'Shared library (main)';
      else {
        try {
          const cpXml = fs.readFileSync(path.join(ctx.cwd, csproj), 'utf-8');
          if (cpXml.includes('Avalonia') || cpXml.includes('WPF') || cpXml.includes('WindowsForms')) role = 'UI library';
          else if (cpXml.includes('Microsoft.AspNetCore')) role = 'Web API';
          else if (cpXml.includes('Microsoft.NET.Sdk.Worker')) role = 'Background service';
        } catch { /* ignore */ }
      }
      ctx.srcSubdirs.push({ name: dirName, role });
    }
  }
}
