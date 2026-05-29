/**
 * Phase 3 — Page Generator
 *
 * Generates markdown pages from a DocPlan using type-specific templates.
 * Each PageType has its own prompt template. Raw pages are generated first
 * (data extraction), then optionally enriched by LLM.
 */

import * as fs from 'fs';
import * as path from 'path';
import { KnowledgeGraph } from '../../knowledge/knowledge-graph.js';
import type { ProjectProfile } from '../discovery/project-discovery.js';
import type { DocPage, DocPlan, PageType } from '../planning/plan-generator.js';
import type { LLMCall, ThinkingLevel } from '../llm-enricher.js';
import type { DocsConfig } from '../config.js';

// ============================================================================
// Language-aware file extensions
// ============================================================================

const LANG_EXT: Record<string, string> = {
  typescript: '.ts', javascript: '.js', python: '.py',
  rust: '.rs', go: '.go', java: '.java', ruby: '.rb',
  php: '.php', csharp: '.cs', cpp: '.cpp', c: '.c',
};

/** Resolve file path with correct extension based on project language */
function resolveFileExt(f: string, language: string): string {
  if (/\.\w{1,5}$/.test(f)) return f;
  return `${f}${LANG_EXT[language] ?? '.ts'}`;
}

// ============================================================================
// Types
// ============================================================================

export interface GeneratedPage {
  page: DocPage;
  content: string;
  filePath: string;
}

export interface GenerationResult {
  pages: GeneratedPage[];
  errors: string[];
  durationMs: number;
}

// ============================================================================
// Page Templates (LLM prompts per page type)
// ============================================================================

const PAGE_TEMPLATES: Record<PageType, string> = {
  'overview': `Generate an overview page that answers:
- What problem does this project solve?
- Who is it for?
- What are the 5 key capabilities?
- What is the high-level architecture? (Mermaid diagram, max 10 nodes)
- What is the tech stack?
- How to get started quickly? (3-step summary)
NEVER start with "This section details...". Use storytelling.`,

  'getting-started': `Generate a getting started guide:
- Prerequisites (runtime, tools)
- Installation steps (copy-paste commands from the scripts provided)
- First run using the ACTUAL scripts from package.json (provided in context)
- Common configuration options
- "Next steps" links to deeper docs
CRITICAL: Use ONLY the real npm scripts and commands from the context. Do NOT invent Express middleware, API routes, or import statements that don't exist.`,

  'key-concepts': `Generate a key concepts glossary:
- 10-20 core concepts of this project
- Each concept: **Bold name** — 1-sentence definition
- Group related concepts together
- Add a Mermaid diagram showing how concepts relate (max 10 nodes)`,

  'architecture': `Generate an architecture page:
- High-level system overview
- "How it works" narrative: user action → system flow → result
- Layer diagram (Mermaid, max 10 nodes)
- Core flow explained step by step
- Key design decisions and trade-offs
- Data flow description`,

  'component': `Generate a component page:
- What is this component and why does it exist?
- Architecture diagram showing relationships (max 10 nodes)
- Key methods grouped by category in tables
- Important patterns used (Facade, Singleton, etc.)
- Developer tip: what to watch out for
- Sources citations`,

  'subsystem': `Generate a subsystem overview:
- What problem does this subsystem solve?
- How do the components relate? (Mermaid diagram, max 10 nodes)
- Table of modules with descriptions
- Data flow within the subsystem
- Entry points for developers`,

  'api-reference': `Generate an API reference:
- All public endpoints/commands grouped by category
- Each entry: name, params, description
- Example usage per category
- Error handling notes`,

  'configuration': `Generate a configuration reference:
- All configuration options grouped by category
- Each option: name, type, default, description
- Environment variables table
- Config file format examples
- Configuration hierarchy (precedence order)`,

  'security': `Generate a security page:
- Security model overview
- Authentication/Authorization mechanisms
- What is protected and how
- Security checklist for contributors
- Threat model summary`,

  'troubleshooting': `Generate a troubleshooting guide:
- 10 most common issues (inferred from the codebase patterns)
- Each: **Symptom** → **Cause** → **Solution**
- Debug mode instructions
- How to report issues`,

  'testing': `Generate a testing guide:
- Test framework and configuration
- Test organization (unit, integration, e2e)
- How to run tests (commands from package.json)
- Test patterns and conventions used
- Coverage reporting
- Writing new tests (patterns to follow)`,
};

/** Thinking level per page type */
const THINKING_LEVELS: Record<PageType, ThinkingLevel> = {
  'overview': 'high',
  'architecture': 'high',
  'key-concepts': 'medium',
  'component': 'medium',
  'subsystem': 'medium',
  'security': 'medium',
  'api-reference': 'low',
  'configuration': 'low',
  'getting-started': 'low',
  'troubleshooting': 'medium',
  'testing': 'low',
};

// ============================================================================
// Generator
// ============================================================================

export async function generatePages(
  plan: DocPlan,
  graph: KnowledgeGraph,
  config: DocsConfig,
  llmCall?: LLMCall,
  onProgress?: (page: string, current: number, total: number) => void,
  incremental?: boolean,
): Promise<GenerationResult> {
  const startTime = Date.now();
  const outputDir = path.join(process.cwd(), config.outputDir);
  const errors: string[] = [];
  const generatedPages: GeneratedPage[] = [];

  // Ensure output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Load manifest for incremental mode
  let manifest: Record<string, { generatedAt: number; sourceFiles: string[] }> = {};
  const manifestPath = path.join(outputDir, '.manifest.json');
  if (incremental) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch { /* no manifest — full rebuild */ }
  }

  // Clean old docs (skip in incremental mode)
  if (!incremental) {
    for (const f of fs.readdirSync(outputDir)) {
      if (f.endsWith('.md')) fs.unlinkSync(path.join(outputDir, f));
    }
  }

  const profile = plan.projectProfile;

  for (let i = 0; i < plan.pages.length; i++) {
    const page = plan.pages[i];
    if (!page) continue;
    onProgress?.(page.title, i + 1, plan.pages.length);

    // Incremental: skip pages whose source files haven't changed
    const entry = incremental ? manifest[page.slug] : undefined;
    if (entry) {
      const pageFile = path.join(outputDir, `${page.slug}.md`);
      if (fs.existsSync(pageFile)) {
        // Check if any source file was modified after last generation
        let anyChanged = false;
        for (const src of page.sourceFiles.slice(0, 10)) {
          try {
            const resolved = resolveFileExt(src, profile.language);
            const mtime = fs.statSync(path.join(process.cwd(), resolved)).mtimeMs;
            if (mtime > entry.generatedAt) { anyChanged = true; break; }
          } catch { anyChanged = true; break; }
        }
        if (!anyChanged) {
          // Reuse existing page
          const content = fs.readFileSync(pageFile, 'utf-8');
          generatedPages.push({ page, content, filePath: pageFile });
          onProgress?.(`${page.title} (cached)`, i + 1, plan.pages.length);
          continue;
        }
      }
    }

    try {
      let content: string;

      if (llmCall) {
        // Try LLM with retry on transient errors, fallback to raw
        content = await generatePageWithRetry(page, plan, profile, graph, config, llmCall);
      } else {
        content = generatePageRaw(page, profile, graph, config);
      }

      // Add DeepWiki-style source files block + Summary if missing
      content = addDeepWikiStructure(content, page, config);

      const filePath = path.join(outputDir, `${page.slug}.md`);
      fs.writeFileSync(filePath, content);
      generatedPages.push({ page, content, filePath });
    } catch (err) {
      errors.push(`${page.slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Generate index page
  const indexContent = generateIndexPage(plan, generatedPages);
  fs.writeFileSync(path.join(outputDir, 'index.md'), indexContent);

  return {
    pages: generatedPages,
    errors,
    durationMs: Date.now() - startTime,
  };
}

// ============================================================================
// LLM-based Page Generation
// ============================================================================

async function generatePageWithLLM(
  page: DocPage,
  plan: DocPlan,
  profile: ProjectProfile,
  graph: KnowledgeGraph,
  config: DocsConfig,
  llmCall: LLMCall,
): Promise<string> {
  const template = PAGE_TEMPLATES[page.pageType];
  const context = buildPageContext(page, profile, graph, config);
  const thinkingLevel = THINKING_LEVELS[page.pageType];

  const systemPrompt = `You are a senior technical writer documenting "${profile.name}" in DeepWiki style.

MANDATORY STRUCTURE for every page:
1. After the # title, add "For [concept], see [Page]." cross-links to 2-3 related pages
2. After each ## section, add: **Sources:** [filename:L1-L100](repo-link) citing ONLY files from the "Source files to cite" list
3. Mermaid diagrams: max ${config.maxNodesPerDiagram} nodes, use "quotes" for labels
4. End with ## Summary section containing 3-5 key takeaways as numbered list

**FORBIDDEN:**
- Do NOT invent APIs, endpoints, class names, function signatures, or code examples. Only describe what exists in the context data.
- Do NOT cite academic papers (e.g. "Wei et al., 2023"), internal engineering docs, or external references — ONLY cite actual source files listed below.
- Do NOT use function/class names that don't appear in the context data.
- Do NOT start sections with "This section details...", "This module provides...", or "The following describes...".

NARRATION STYLE — WHY-first storytelling:

BAD: "The ContextManager class provides context compression functionality. It uses sliding window and summarization."
GOOD: "As conversations grow, sending the full history to the LLM would exceed token limits and balloon costs. The ContextManager solves this by compressing older messages while preserving the most relevant context — using a sliding window for recent turns and summarization for older ones."

BAD: "This section details the security subsystem. It contains several modules."
GOOD: "Every tool call the agent makes is a potential attack surface. A prompt injection could trick the agent into running \`rm -rf /\` or leaking credentials. The security subsystem exists to prevent this — here's how each layer contributes."

RULES:
- Explain WHY something exists before HOW it works
- Maximum 2 developer tips per page (not 5)
- **Sources:** must ONLY cite files from the source file list — never invent filenames
- Output complete markdown — your output IS the final page`;

  // Build related page links for cross-references
  const relatedLinks = page.relatedPages
    .map(id => plan.pages.find(p => p.id === id))
    .filter(Boolean)
    .map(p => `[${p!.title}](./${p!.slug}.md)`)
    .join(', ');

  const repoBase = config.repoUrl ? `${config.repoUrl}/blob/${config.commit || 'main'}/` : '';
  const sourceFilesList = page.sourceFiles.slice(0, 5).map(f => {
    const resolved = resolveFileExt(f, profile.language);
    // Get real line count for accurate citations
    let lineCount = 0;
    try {
      const filePath = path.join(process.cwd(), resolved);
      lineCount = fs.readFileSync(filePath, 'utf-8').split('\n').length;
    } catch { /* file not found */ }
    // Skip files that can't be found — prevents L1-L0 citations
    if (lineCount === 0) return null;
    return `${resolved} (L1-L${lineCount}) → ${repoBase}${resolved}`;
  }).filter(Boolean).join('\n');

  // Build inspired-by instruction if relevant features exist
  const inspiredInstruction = profile.readmeContext?.inspiredFeatures?.length
    ? `\nIMPORTANT: If the context data lists "Inspired-by features", you MUST include a dedicated "## Inspired-By Architecture" section describing them. These features (like Native Engine, Codex, OpenManus patterns) are a core differentiator of the project.`
    : '';

  const userPrompt = `${template}${inspiredInstruction}

Project: ${profile.name} (${profile.language}${profile.framework ? ', ' + profile.framework : ''})
${profile.metrics.totalModules} modules, ${profile.metrics.totalFunctions} functions
Repo: ${config.repoUrl || 'local'}

Page: "${page.title}" (${page.description})
Related pages for cross-links: ${relatedLinks || 'none'}
Source files to cite:
${sourceFilesList || 'none'}

Context data (ONLY use facts from this data, do NOT invent):
${context}

Generate the full markdown page. Start with # ${page.title}`;

  const result = await llmCall(systemPrompt, userPrompt, thinkingLevel);

  // Strip LLM noise
  return stripNoise(result);
}

/**
 * Try LLM generation with 1 retry on transient errors (503, 429, timeout).
 * Falls back to raw generation if both attempts fail.
 */
async function generatePageWithRetry(
  page: DocPage,
  plan: DocPlan,
  profile: ProjectProfile,
  graph: KnowledgeGraph,
  config: DocsConfig,
  llmCall: LLMCall,
): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await generatePageWithLLM(page, plan, profile, graph, config, llmCall);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = /503|429|UNAVAILABLE|timeout|rate.limit|overloaded/i.test(msg);
      if (isTransient && attempt === 0) {
        // Wait 5s before retry
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      // Non-transient or second attempt failed — fall back to raw
      break;
    }
  }
  // Fallback to raw generation instead of losing the page
  return generatePageRaw(page, profile, graph, config);
}

// ============================================================================
// Raw Page Generation (no LLM)
// ============================================================================

function generatePageRaw(
  page: DocPage,
  profile: ProjectProfile,
  graph: KnowledgeGraph,
  config: DocsConfig,
): string {
  switch (page.pageType) {
    case 'overview': return rawOverview(profile);
    case 'getting-started': return rawGettingStarted(profile);
    case 'key-concepts': return rawKeyConcepts(profile, graph);
    case 'architecture': return rawArchitecture(page, profile, graph, config);
    case 'subsystem': return rawSubsystem(page, profile, graph);
    case 'component': return rawComponent(page, profile, graph);
    case 'configuration': return rawConfiguration(profile);
    case 'security': return rawSecurity(profile, graph);
    case 'api-reference': return rawApiReference(profile);
    case 'troubleshooting': return rawTroubleshooting(profile);
    case 'testing': return rawTesting(profile);
    default: return `# ${page.title}\n\n${page.description}\n`;
  }
}

// ============================================================================
// Raw Templates
// ============================================================================

function rawOverview(p: ProjectProfile): string {
  const lines = [
    `# ${p.name} v${p.version}`,
    '',
    p.description ? `> ${p.description}` : '',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Modules | ${p.metrics.totalModules} |`,
    `| Classes | ${p.metrics.totalClasses} |`,
    `| Functions | ${p.metrics.totalFunctions} |`,
    `| Relationships | ${p.metrics.totalRelationships.toLocaleString()} |`,
    '',
    '## Core Modules',
    '',
    '| Module | PageRank | Functions |',
    '|--------|----------|-----------|',
  ];
  for (const m of p.architecture.coreModules.slice(0, 15)) {
    lines.push(`| \`${m.path}\` | ${m.rank.toFixed(3)} | ${m.functions} |`);
  }
  lines.push('', '## Technology Stack', '');
  lines.push(`- Language: ${p.language}`);
  if (p.framework) lines.push(`- Framework: ${p.framework}`);
  lines.push(`- Dependencies: ${p.dependencies.length}`);

  // Inspired-by features (Native Engine, Codex, OpenManus)
  if (p.readmeContext?.inspiredFeatures && p.readmeContext.inspiredFeatures.length > 0) {
    lines.push('', '## Inspired-By Architecture', '');
    for (const f of p.readmeContext.inspiredFeatures) {
      const loc = f.location ? ` (\`${f.location}\`)` : '';
      lines.push(`- **${f.name}** (${f.source})${loc}${f.description ? ' — ' + f.description : ''}`);
    }
  }

  // Key subsystems from CLAUDE.md
  if (p.readmeContext?.subsystemTable) {
    lines.push('', '## Key Subsystems', '');
    // Extract first 15 rows from the table
    const tableLines = p.readmeContext.subsystemTable.split('\n').slice(0, 17);
    lines.push(...tableLines);
  }

  // Getting Started
  lines.push('', '## Getting Started', '', '```bash', 'npm install');
  if (p.scripts.build) lines.push('npm run build');
  if (p.scripts.dev) lines.push('npm run dev');
  if (p.scripts.start) lines.push('npm start');
  lines.push('```');

  return lines.join('\n');
}

function rawGettingStarted(p: ProjectProfile): string {
  const lines = [
    '# Getting Started', '',
    '## Prerequisites', '',
    `- ${p.language === 'typescript' || p.language === 'javascript' ? 'Node.js 18+' : p.language} runtime`,
    '',
    '## Installation', '',
    '```bash',
    ...(p.repoUrl ? [`git clone ${p.repoUrl}`, `cd ${p.name}`] : [`cd ${p.name}`]),
    'npm install',
    '```', '',
    '## First Run', '',
    '```bash',
  ];
  if (p.scripts.dev) lines.push('npm run dev');
  else if (p.scripts.start) lines.push('npm start');
  lines.push('```', '', '## Available Scripts', '', '| Script | Command |', '|--------|---------|');
  for (const [name, cmd] of Object.entries(p.scripts).slice(0, 15)) {
    lines.push(`| \`npm run ${name}\` | \`${cmd}\` |`);
  }
  return lines.join('\n');
}

function rawKeyConcepts(p: ProjectProfile, graph: KnowledgeGraph): string {
  const lines = ['# Key Concepts', ''];
  // Top 15 entities as concepts
  for (const m of p.architecture.coreModules.slice(0, 15)) {
    const name = m.path.split('/').pop() ?? m.path;
    lines.push(`- **${name}** — Core module (${m.functions} functions, PageRank ${m.rank.toFixed(3)})`);
  }
  // Patterns as concepts
  for (const pat of p.patterns.slice(0, 5)) {
    lines.push(`- **${pat.name}** — Design pattern found in \`${pat.location}\``);
  }
  return lines.join('\n');
}

function rawArchitecture(page: DocPage, p: ProjectProfile, graph: KnowledgeGraph, config: DocsConfig): string {
  const lines = [
    `# ${page.title}`, '',
    `Architecture type: **${p.architecture.type}**`, '',
    '## Layers', '',
    '| Layer | Modules |',
    '|-------|---------|',
  ];
  for (const l of p.architecture.layers.slice(0, 15)) {
    lines.push(`| \`${l.directory}\` | ${l.moduleCount} |`);
  }
  lines.push('', '## Entry Points', '');
  for (const ep of p.architecture.entryPoints.slice(0, 5)) {
    lines.push(`- \`${ep.path}\``);
  }

  // Mermaid layer diagram
  const topLayers = p.architecture.layers.slice(0, 8);
  if (topLayers.length >= 3) {
    lines.push('', '## Layer Diagram', '', '```mermaid', 'graph TD');
    for (const l of topLayers) {
      lines.push(`  ${JSON.stringify(l.name)}["${l.name} (${l.moduleCount})"]`);
    }
    // Connect layers linearly (simplified)
    for (let i = 0; i < topLayers.length - 1; i++) {
      const from = topLayers[i];
      const to = topLayers[i + 1];
      if (!from || !to) continue;
      lines.push(`  ${JSON.stringify(from.name)} --> ${JSON.stringify(to.name)}`);
    }
    lines.push('```');
  }

  return lines.join('\n');
}

function rawSubsystem(page: DocPage, p: ProjectProfile, graph: KnowledgeGraph): string {
  const lines = [`# ${page.title}`, '', page.description, ''];

  // Mermaid dependency diagram (top 6 modules by importers)
  const topForDiagram = page.sourceFiles.slice(0, 8)
    .map(src => ({
      src,
      short: src.split('/').pop()?.replace(/\.\w+$/, '') ?? src,
      importers: graph.query({ predicate: 'imports', object: `mod:${src}` }).length,
    }))
    .sort((a, b) => b.importers - a.importers)
    .slice(0, 6);

  if (topForDiagram.length >= 2) {
    lines.push('## Module Dependencies', '', '```mermaid', 'graph TD');
    // Build edges from internal imports
    const slugSet = new Set(page.sourceFiles);
    const addedEdges = new Set<string>();
    for (const { src, short } of topForDiagram) {
      const imports = graph.query({ subject: `mod:${src}`, predicate: 'imports' });
      for (const t of imports) {
        const dep = t.object.replace(/^mod:/, '');
        if (!slugSet.has(dep)) continue;
        const depShort = dep.split('/').pop()?.replace(/\.\w+$/, '') ?? dep;
        const edge = `${short}->${depShort}`;
        if (addedEdges.has(edge) || short === depShort) continue;
        addedEdges.add(edge);
        lines.push(`  ${JSON.stringify(short)} --> ${JSON.stringify(depShort)}`);
      }
    }
    // If no internal edges, show isolated nodes
    if (addedEdges.size === 0) {
      for (const { short } of topForDiagram.slice(0, 4)) {
        lines.push(`  ${JSON.stringify(short)}`);
      }
    }
    lines.push('```', '');
  }

  // Module table with functions, classes, and importers
  lines.push('## Modules', '', '| Module | Functions | Classes | Imported By |', '|--------|-----------|---------|-------------|');
  for (const src of page.sourceFiles.slice(0, 20)) {
    const mod = `mod:${src}`;
    const fns = graph.query({ subject: mod, predicate: 'containsFunction' }).length;
    const cls = graph.query({ subject: mod, predicate: 'containsClass' }).length;
    const importers = graph.query({ predicate: 'imports', object: mod }).length;
    lines.push(`| \`${src}\` | ${fns} | ${cls} | ${importers} |`);
  }

  // Key functions from top modules (by importer count)
  const topModules = page.sourceFiles.slice(0, 5)
    .map(src => ({ src, importers: graph.query({ predicate: 'imports', object: `mod:${src}` }).length }))
    .sort((a, b) => b.importers - a.importers)
    .slice(0, 3);
  if (topModules.length > 0) {
    lines.push('', '## Key Functions', '');
    for (const { src } of topModules) {
      const fns = graph.query({ subject: `mod:${src}`, predicate: 'containsFunction' })
        .map(t => t.object.replace(/^fn:/, ''))
        .slice(0, 8);
      if (fns.length > 0) {
        const modName = src.split('/').pop() ?? src;
        lines.push(`**${modName}:** \`${fns.join('`, `')}\``);
      }
    }
  }

  // Cross-subsystem dependencies: which other subsystems import/are imported by this one
  const subsystemFiles = new Set(page.sourceFiles);
  const externalImporters = new Map<string, number>(); // external dir → count
  const externalDeps = new Map<string, number>();
  for (const src of page.sourceFiles.slice(0, 15)) {
    const mod = `mod:${src}`;
    // Who imports us from outside this subsystem?
    for (const t of graph.query({ predicate: 'imports', object: mod })) {
      const importer = t.subject.replace(/^mod:/, '');
      if (!subsystemFiles.has(importer)) {
        const dir = importer.split('/').slice(0, 2).join('/');
        externalImporters.set(dir, (externalImporters.get(dir) ?? 0) + 1);
      }
    }
    // What do we import from outside?
    for (const t of graph.query({ subject: mod, predicate: 'imports' })) {
      const dep = t.object.replace(/^mod:/, '');
      if (!subsystemFiles.has(dep)) {
        const dir = dep.split('/').slice(0, 2).join('/');
        externalDeps.set(dir, (externalDeps.get(dir) ?? 0) + 1);
      }
    }
  }
  if (externalImporters.size > 0 || externalDeps.size > 0) {
    lines.push('', '## Cross-Subsystem Dependencies', '');
    if (externalImporters.size > 0) {
      const sorted = [...externalImporters.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      lines.push(`**Imported by:** ${sorted.map(([dir, n]) => `\`${dir}/\` (${n})`).join(', ')}`);
    }
    if (externalDeps.size > 0) {
      const sorted = [...externalDeps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      lines.push(`**Depends on:** ${sorted.map(([dir, n]) => `\`${dir}/\` (${n})`).join(', ')}`);
    }
  }

  // Detected patterns in this subsystem
  const subsystemPatterns = p.patterns.filter(pat =>
    page.sourceFiles.some(src => pat.location.includes(src) || src.includes(pat.location)),
  );
  if (subsystemPatterns.length > 0) {
    lines.push('', '## Patterns', '');
    for (const pat of subsystemPatterns.slice(0, 5)) {
      lines.push(`- **${pat.name}** in \`${pat.location}\` — ${pat.evidence}`);
    }
  }

  return lines.join('\n');
}

function rawComponent(page: DocPage, p: ProjectProfile, graph: KnowledgeGraph): string {
  const mod = page.sourceFiles[0];
  const lines = [`# ${page.title}`, '', page.description, ''];
  if (!mod) return lines.join('\n');

  const modEntity = `mod:${mod}`;

  // Functions with caller count
  const fns = graph.query({ subject: modEntity, predicate: 'containsFunction' });
  if (fns.length > 0) {
    lines.push('## Functions', '', '| Function | Callers |', '|----------|---------|');
    const fnData = fns.slice(0, 25).map(fn => {
      const fnName = fn.object.replace(/^fn:/, '');
      const callers = graph.query({ predicate: 'calls', object: fn.object }).length;
      return { name: fnName, callers };
    }).sort((a, b) => b.callers - a.callers);
    for (const { name, callers } of fnData) {
      lines.push(`| \`${name}\` | ${callers} |`);
    }
  }

  // Incoming dependencies (who imports this component)
  const importers = graph.query({ predicate: 'imports', object: modEntity });
  if (importers.length > 0) {
    lines.push('', '## Imported By', '');
    for (const t of importers.slice(0, 10)) {
      lines.push(`- \`${t.subject.replace(/^mod:/, '')}\``);
    }
  }

  // Outgoing dependencies (what this component imports)
  const deps = graph.query({ subject: modEntity, predicate: 'imports' });
  if (deps.length > 0) {
    lines.push('', '## Dependencies', '');
    for (const t of deps.slice(0, 10)) {
      lines.push(`- \`${t.object.replace(/^mod:/, '')}\``);
    }
  }

  return lines.join('\n');
}

function rawConfiguration(p: ProjectProfile): string {
  const lines = ['# Configuration', ''];
  if (p.envVars.length > 0) {
    lines.push('## Environment Variables', '', '| Variable | Description |', '|----------|-------------|');
    for (const v of p.envVars) {
      lines.push(`| \`${v.name}\` | ${v.desc} |`);
    }
  }
  return lines.join('\n');
}

function rawSecurity(p: ProjectProfile, graph: KnowledgeGraph): string {
  const lines = ['# Security', ''];
  const secLayer = p.architecture.layers.find(l => l.name === 'security');
  if (secLayer) {
    lines.push(`The project has **${secLayer.moduleCount}** security modules in \`${secLayer.directory}/\`.`, '');
  }

  // Security-related dependencies
  const secDeps = p.dependencies.filter(d =>
    /^(jsonwebtoken|passport|bcrypt|helmet|cors|csurf|express-rate-limit|sanitize-html|validator|oauth|jose|argon2)$/i.test(d),
  );
  if (secDeps.length > 0) {
    lines.push('## Security Dependencies', '', '| Package | Category |', '|---------|----------|');
    for (const dep of secDeps) {
      const cat = /jwt|jose|oauth|passport/i.test(dep) ? 'Authentication' :
        /bcrypt|argon/i.test(dep) ? 'Hashing' :
          /helmet|cors|csrf|rate-limit/i.test(dep) ? 'HTTP Hardening' : 'Validation';
      lines.push(`| \`${dep}\` | ${cat} |`);
    }
    lines.push('');
  }

  // Security-related modules — scan ALL modules in security layer, not just top-20
  const securityLayerModules: Array<{ path: string; functions: number; importers: number }> = [];
  const secDir = secLayer?.directory ?? 'src/security';
  // Get all modules matching security patterns from the graph
  const allTriples = graph.toJSON();
  const secModules = new Set<string>();
  for (const t of allTriples) {
    for (const entity of [t.subject, t.object]) {
      if (entity.startsWith('mod:') && (
        entity.includes(`${secDir}/`) ||
        /\b(auth|security|guard|permission|policy|sandbox|encrypt|vault|secret)/i.test(entity)
      )) {
        secModules.add(entity);
      }
    }
  }
  for (const mod of secModules) {
    const modPath = mod.replace(/^mod:/, '');
    const fns = graph.query({ subject: mod, predicate: 'containsFunction' }).length;
    const importers = graph.query({ predicate: 'imports', object: mod }).length;
    securityLayerModules.push({ path: modPath, functions: fns, importers });
  }
  securityLayerModules.sort((a, b) => b.importers - a.importers);

  if (securityLayerModules.length > 0) {
    lines.push('## Security Modules', '', '| Module | Functions | Imported By |', '|--------|-----------|-------------|');
    for (const m of securityLayerModules.slice(0, 25)) {
      lines.push(`| \`${m.path}\` | ${m.functions} | ${m.importers} |`);
    }
  }

  return lines.join('\n');
}

function rawApiReference(p: ProjectProfile): string {
  const lines = ['# API Reference', ''];

  // CLI commands from API surface discovery
  if (p.apiSurface && p.apiSurface.cliCommands.length > 0) {
    lines.push('## CLI Commands', '', '| Command | Description |', '|---------|-------------|');
    for (const cmd of p.apiSurface.cliCommands.slice(0, 30)) {
      lines.push(`| \`${cmd}\` | — |`);
    }
    lines.push('');
  } else if (p.dependencies.includes('commander')) {
    lines.push('## CLI', '', 'See `--help` for available commands.', '');
  }

  // HTTP endpoints from API surface discovery
  if (p.apiSurface && p.apiSurface.httpEndpoints.length > 0) {
    lines.push('## HTTP API', '', '| Method | Path |', '|--------|------|');
    for (const ep of p.apiSurface.httpEndpoints.slice(0, 50)) {
      lines.push(`| \`${ep.method}\` | \`${ep.path}\` |`);
    }
    lines.push('');
  } else if (p.dependencies.includes('express') || p.dependencies.includes('fastify')) {
    lines.push('## HTTP API', '', 'See route files for endpoints.', '');
  }

  return lines.join('\n');
}

function rawTroubleshooting(p: ProjectProfile): string {
  const lines = [
    '# Troubleshooting', '',
    '## Common Issues', '',
    '| Symptom | Cause | Solution |',
    '|---------|-------|----------|',
    '| Module not found | Missing build step | Run `npm run build` |',
    '| API key error | Missing env var | Set required API key in `.env` |',
    '| Tests fail | Outdated deps | Run `npm install` |',
  ];

  // Add env var issues
  for (const v of p.envVars.slice(0, 5)) {
    lines.push(`| \`${v.name}\` not set | Missing environment variable | \`export ${v.name}=...\` |`);
  }

  lines.push('', '## Debug Mode', '');
  if (p.scripts.dev) lines.push(`Run in development mode: \`npm run dev\``, '');
  if (p.scripts.test) lines.push(`Run tests: \`npm test\``, '');
  if (p.scripts.lint) lines.push(`Check code quality: \`npm run lint\``, '');

  return lines.join('\n');
}

function rawTesting(p: ProjectProfile): string {
  const lines = ['# Testing', ''];

  if (p.testInfo) {
    lines.push(`**Framework:** ${p.testInfo.framework}`, '');
    lines.push(`**Total test files:** ${p.testInfo.totalFiles}`, '');

    if (Object.keys(p.testInfo.byType).length > 0) {
      lines.push('## Test Organization', '', '| Type | Files |', '|------|-------|');
      for (const [type, count] of Object.entries(p.testInfo.byType)) {
        lines.push(`| ${type} | ${count} |`);
      }
      lines.push('');
    }
  }

  // Test scripts from package.json
  const testScripts = Object.entries(p.scripts).filter(([k]) =>
    /test|spec|coverage|e2e/i.test(k),
  );
  if (testScripts.length > 0) {
    lines.push('## Running Tests', '', '```bash');
    for (const [name, cmd] of testScripts) {
      lines.push(`npm run ${name}  # ${cmd}`);
    }
    lines.push('```');
  }

  return lines.join('\n');
}

// ============================================================================
// Index Page
// ============================================================================

function generateIndexPage(plan: DocPlan, pages: GeneratedPage[]): string {
  const p = plan.projectProfile;
  const lines = [
    `# ${p.name} — Documentation`,
    '',
    p.description ? `> ${p.description}` : '',
    '',
    `*Generated: ${new Date().toISOString().split('T')[0]}*`,
    '',
    '## Where to start?',
    '',
    '| I want to... | Go to... |',
    '|-------------|----------|',
  ];

  // Smart routing table
  // Map by pageType — first match wins, so put canonical pages first
  const pageMap = new Map<PageType, DocPage>();
  for (const pg of plan.pages) {
    if (!pageMap.has(pg.pageType)) pageMap.set(pg.pageType, pg);
  }
  const link = (type: PageType, label: string) => {
    const pg = pageMap.get(type);
    return pg ? `[${pg.title}](./${pg.slug}.md)` : label;
  };

  lines.push(`| Understand the project | ${link('overview', 'Overview')} |`);
  lines.push(`| Get started quickly | ${link('getting-started', 'Getting Started')} |`);
  if (pageMap.has('architecture')) lines.push(`| Understand the architecture | ${link('architecture', 'Architecture')} |`);
  if (pageMap.has('configuration')) lines.push(`| Configure the project | ${link('configuration', 'Configuration')} |`);
  if (pageMap.has('security')) lines.push(`| Understand security | ${link('security', 'Security')} |`);
  if (pageMap.has('api-reference')) lines.push(`| Use the CLI or API | ${link('api-reference', 'API Reference')} |`);
  if (pageMap.has('troubleshooting')) lines.push(`| Fix an issue | ${link('troubleshooting', 'Troubleshooting')} |`);

  lines.push('', '## Project at a Glance', '', '| Metric | Value |', '|--------|-------|');
  lines.push(`| Modules | ${p.metrics.totalModules.toLocaleString()} |`);
  lines.push(`| Functions | ${p.metrics.totalFunctions.toLocaleString()} |`);
  lines.push(`| Relationships | ${p.metrics.totalRelationships.toLocaleString()} |`);

  // All pages grouped by hierarchy (3-level support)
  lines.push('', '## All Sections', '');
  const topLevel = plan.pages.filter(p => !p.parentId);
  const allChildren = plan.pages.filter(p => p.parentId);
  const listed = new Set<string>();

  for (const page of topLevel) {
    lines.push(`- [${page.id}. ${page.title}](./${page.slug}.md)`);
    listed.add(page.id);
    const kids = allChildren.filter(c => c.parentId === page.id);
    for (const kid of kids) {
      lines.push(`  - [${kid.id}. ${kid.title}](./${kid.slug}.md)`);
      listed.add(kid.id);
      // 3rd level: grandchildren
      const grandkids = allChildren.filter(c => c.parentId === kid.id);
      for (const gk of grandkids) {
        lines.push(`    - [${gk.id}. ${gk.title}](./${gk.slug}.md)`);
        listed.add(gk.id);
      }
    }
  }

  // List orphan pages whose parentId doesn't match any existing page
  const orphans = plan.pages.filter(p => !listed.has(p.id));
  for (const page of orphans) {
    lines.push(`- [${page.id}. ${page.title}](./${page.slug}.md)`);
  }

  return lines.join('\n');
}

// ============================================================================
// Helpers
// ============================================================================

function buildPageContext(
  page: DocPage,
  profile: ProjectProfile,
  graph: KnowledgeGraph,
  config: DocsConfig,
): string {
  const contextParts: string[] = [];

  // Sort source files by PageRank for better context prioritization
  const rankedSources = page.sourceFiles.slice(0, config.maxModulesPerPage).map(src => ({
    src,
    rank: graph.getEntityRank(`mod:${src}`),
  })).sort((a, b) => b.rank - a.rank);

  // Add source file data with real line counts
  for (const { src } of rankedSources) {
    const mod = `mod:${src}`;
    const resolved = resolveFileExt(src, profile.language);
    const fns = graph.query({ subject: mod, predicate: 'containsFunction' }).map(t => t.object.replace(/^fn:/, ''));
    const cls = graph.query({ subject: mod, predicate: 'containsClass' }).map(t => t.object.replace(/^cls:/, ''));
    const importedBy = graph.query({ predicate: 'imports', object: mod }).length;
    // Real line count for accurate citations
    let lineCount = 0;
    try {
      lineCount = fs.readFileSync(path.join(process.cwd(), resolved), 'utf-8').split('\n').length;
    } catch { /* file not found */ }
    // Only include line info when we can verify the file
    const lineInfo = lineCount > 0 ? `, L1-L${lineCount}` : '';
    contextParts.push(`Module: ${resolved} (${fns.length} functions, ${cls.length} classes, ${importedBy} importers${lineInfo})`);
    if (fns.length > 0) contextParts.push(`  Functions: ${fns.slice(0, 15).join(', ')}`);
    if (cls.length > 0) contextParts.push(`  Classes: ${cls.join(', ')}`);
  }

  // Add relevant metrics
  if (page.pageType === 'overview' || page.pageType === 'architecture') {
    contextParts.push('');
    contextParts.push(`Architecture: ${profile.architecture.type}`);
    contextParts.push(`Layers: ${profile.architecture.layers.slice(0, 10).map(l => `${l.name}(${l.moduleCount})`).join(', ')}`);
    contextParts.push(`Patterns: ${profile.patterns.slice(0, 5).map(p => `${p.name}@${p.location}`).join(', ')}`);
    // Inject README/CLAUDE.md context for richer overviews
    if (profile.readmeContext) {
      if (profile.readmeContext.problemStatement) {
        contextParts.push(`Problem statement: ${profile.readmeContext.problemStatement}`);
      }
      if (profile.readmeContext.features.length > 0) {
        contextParts.push(`Features: ${profile.readmeContext.features.slice(0, 10).join(', ')}`);
      }
      if (profile.readmeContext.architectureOverview) {
        contextParts.push(`Architecture overview:\n${profile.readmeContext.architectureOverview.substring(0, 1000)}`);
      }
      // Subsystem table from CLAUDE.md
      if (profile.readmeContext.subsystemTable) {
        contextParts.push(`\nKey subsystems:\n${profile.readmeContext.subsystemTable.substring(0, 2000)}`);
      }
      // Inspired-by features (Native Engine, Codex, etc.)
      if (profile.readmeContext.inspiredFeatures.length > 0) {
        contextParts.push('\nInspired-by features (important — MENTION these in the page):');
        for (const f of profile.readmeContext.inspiredFeatures) {
          contextParts.push(`  ${f.name} (${f.source}-inspired) → ${f.location || 'various'}: ${f.description}`);
        }
      }
    }
  }

  // Add scripts for getting-started page
  if (page.pageType === 'getting-started') {
    contextParts.push('');
    contextParts.push('REAL npm scripts from package.json (use these, do NOT invent others):');
    for (const [name, cmd] of Object.entries(profile.scripts).slice(0, 15)) {
      contextParts.push(`  npm run ${name} → ${cmd}`);
    }
    if (profile.repoUrl) contextParts.push(`Repo URL: ${profile.repoUrl}`);
    contextParts.push(`Project name: ${profile.name}`);
  }

  // Add env vars for config page
  if (page.pageType === 'configuration') {
    contextParts.push('');
    contextParts.push('Environment variables:');
    for (const v of profile.envVars.slice(0, 20)) {
      contextParts.push(`  ${v.name}: ${v.desc}`);
    }
    contextParts.push(`Scripts: ${Object.entries(profile.scripts).slice(0, 10).map(([k, v]) => `${k}="${v}"`).join(', ')}`);
  }

  // Add API/CLI context for api-reference pages
  if (page.pageType === 'api-reference') {
    contextParts.push('');
    // CLI commands from entry point
    const entryPoint = profile.architecture.entryPoints[0];
    if (entryPoint) {
      contextParts.push(`CLI entry point: ${entryPoint.path}`);
      if (entryPoint.functions.length > 0) {
        contextParts.push(`  Commands/functions: ${entryPoint.functions.slice(0, 20).join(', ')}`);
      }
    }
    // Scan for HTTP route layers
    const routeLayers = profile.architecture.layers.filter(l =>
      /^(server|routes?|api|endpoints?|controllers?)$/i.test(l.name),
    );
    if (routeLayers.length > 0) {
      contextParts.push('HTTP/API layers:');
      for (const layer of routeLayers) {
        contextParts.push(`  ${layer.directory}/ (${layer.moduleCount} modules)`);
        // Try to read route files for .get(/.post( patterns
        try {
          const layerDir = path.join(process.cwd(), layer.directory);
          if (fs.existsSync(layerDir)) {
            const files = fs.readdirSync(layerDir).filter(f => /\.(ts|js)$/.test(f)).slice(0, 5);
            for (const file of files) {
              const content = fs.readFileSync(path.join(layerDir, file), 'utf-8');
              const routes = [...content.matchAll(/\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi)];
              if (routes.length > 0) {
                contextParts.push(`  Routes in ${file}: ${routes.map(r => `${(r[1] ?? '').toUpperCase()} ${r[2] ?? ''}`).join(', ')}`);
              }
            }
          }
        } catch { /* can't read route files */ }
      }
    }
    // Public exports from core modules
    if (routeLayers.length === 0 && !entryPoint) {
      contextParts.push('Public modules:');
      for (const m of profile.architecture.coreModules.slice(0, 10)) {
        contextParts.push(`  ${m.path} (${m.functions} functions)`);
      }
    }
  }

  // Add test context for testing pages
  if (page.pageType === 'testing' && profile.testInfo) {
    contextParts.push('');
    contextParts.push(`Test framework: ${profile.testInfo.framework}`);
    contextParts.push(`Total test files: ${profile.testInfo.totalFiles}`);
    for (const [type, count] of Object.entries(profile.testInfo.byType)) {
      contextParts.push(`  ${type}: ${count} files`);
    }
    const testScripts = Object.entries(profile.scripts).filter(([k]) => /test|spec|coverage|e2e/i.test(k));
    if (testScripts.length > 0) {
      contextParts.push('Test scripts:');
      for (const [name, cmd] of testScripts) {
        contextParts.push(`  npm run ${name} → ${cmd}`);
      }
    }
  }

  // For any page with subsystem/component type: inject relevant inspired-by features
  if ((page.pageType === 'subsystem' || page.pageType === 'component') && profile.readmeContext?.inspiredFeatures.length) {
    const relevantFeatures = profile.readmeContext.inspiredFeatures.filter(f =>
      f.location && page.sourceFiles.some(src => f.location.includes(src) || src.includes(f.location.split('/').slice(0, 3).join('/'))),
    );
    if (relevantFeatures.length > 0) {
      contextParts.push('\nInspired-by features in this subsystem (MENTION these):');
      for (const f of relevantFeatures) {
        contextParts.push(`  ${f.name} (${f.source}-inspired) → ${f.location}: ${f.description}`);
      }
    }
  }

  return contextParts.join('\n').substring(0, 8000);
}

/**
 * Add DeepWiki structural elements to a generated page:
 * 1. <details>Relevant source files</details> after title
 * 2. ## Summary with Key Takeaways at the bottom (if missing)
 */
function addDeepWikiStructure(content: string, page: DocPage, config: DocsConfig): string {
  let result = content;
  const repoBase = config.repoUrl ? `${config.repoUrl}/blob/${config.commit || 'main'}/` : '';
  const language = config.language || 'typescript';

  // 1. Add source files block after title
  if (page.sourceFiles.length > 0) {
    const sourceLinks = page.sourceFiles.slice(0, 8).map(f => {
      const resolved = resolveFileExt(f, language);
      const link = repoBase ? `[${resolved}](${repoBase}${resolved})` : `\`${resolved}\``;
      return `- ${link}`;
    }).join('\n');

    const sourceBlock = [
      '',
      '<details>',
      '<summary>Relevant source files</summary>',
      '',
      sourceLinks,
      '',
      '</details>',
      '',
    ].join('\n');

    result = result.replace(/^(# .+\n)/, `$1${sourceBlock}`);
  }

  // 2. Add Summary if missing — build from headings if possible
  if (!result.includes('## Summary') && !result.includes('## Key Takeaways')) {
    const headings = [...result.matchAll(/^## (.+)$/gm)]
      .map(m => (m[1] ?? '').trim())
      .filter(h => h !== 'Summary' && h !== 'Key Takeaways');

    result += '\n\n## Summary\n\n';
    if (headings.length >= 2) {
      result += `**${page.title}** covers:\n`;
      for (let i = 0; i < Math.min(headings.length, 5); i++) {
        result += `${i + 1}. **${headings[i]}**\n`;
      }
    } else {
      result += `This page documents **${page.title}**: ${page.description.toLowerCase()}.\n`;
    }
  }

  return result;
}

function stripNoise(content: string): string {
  let result = content;
  // Remove ```markdown wrapper
  const mdFenceMatch = result.match(/```markdown\n([\s\S]*?)```\s*$/);
  if (mdFenceMatch && mdFenceMatch[1] !== undefined) result = mdFenceMatch[1];
  // Remove preamble before first heading
  const firstHeading = result.indexOf('\n# ');
  if (firstHeading > 0 && firstHeading < 500) result = result.substring(firstHeading + 1);
  else if (!result.startsWith('# ')) {
    const idx = result.indexOf('# ');
    if (idx > 0 && idx < 500) result = result.substring(idx);
  }
  return result.trim();
}
