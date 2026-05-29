/**
 * Path-Scoped Rules Loader
 *
 * Loads .md files from .codebuddy/rules/ with YAML frontmatter
 * that specifies glob patterns. Rules are injected only when
 * a tool accesses a file matching the rule's path pattern.
 *
 * Advanced enterprise architecture for .claude/rules/*.md with frontmatter globs.
 *
 * Frontmatter format:
 *   ---
 *   description: Short description of the rule
 *   paths: ["src/api/**\/*.ts", "src/server/**"]
 *   alwaysApply: false
 *   ---
 *   Rule content in markdown...
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { globToRegex, matchGlob } from '../utils/glob-utils.js';
import { resolveImportDirectives } from './import-directive-parser.js';

// ============================================================================
// Types
// ============================================================================

export interface RuleDefinition {
  /** Source file path (relative to project root) */
  source: string;
  /** Short description */
  description?: string;
  /** Glob patterns that trigger this rule */
  paths: string[];
  /** If true, always include in context regardless of file access */
  alwaysApply: boolean;
  /** Rule content (markdown body after frontmatter) */
  content: string;
}

// ============================================================================
// Frontmatter Parser
// ============================================================================

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns the frontmatter fields and the body content.
 */
function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: raw };
  }

  // The regex guarantees both capture groups exist when `match` is truthy
  // (each is `([\s\S]*?)` / `([\s\S]*)`, which match empty strings), but under
  // noUncheckedIndexedAccess the indexed access is `string | undefined`.
  // Default to '' to preserve the existing behavior for both groups.
  const yamlBlock = match[1] ?? '';
  const body = match[2] ?? '';

  // Simple YAML parser for our limited schema (no dependency on yaml lib)
  const meta: Record<string, unknown> = {};
  for (const line of yamlBlock.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let value: unknown = trimmed.slice(colonIdx + 1).trim();

    // Parse arrays: ["a", "b"]
    if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
      try {
        value = JSON.parse(value);
      } catch {
        // Keep as string if JSON parse fails
      }
    }
    // Parse booleans
    else if (value === 'true') value = true;
    else if (value === 'false') value = false;
    // Strip quotes
    else if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    meta[key] = value;
  }

  return { meta, body };
}

// Re-export for consumers that import from rules-loader
export { globToRegex, matchGlob };

// ============================================================================
// Rules Loader
// ============================================================================

/** Cache of loaded rules */
let _rulesCache: RuleDefinition[] | null = null;
let _rulesCacheDir: string | null = null;

/**
 * Clear the rules cache (for testing).
 */
export function clearRulesCache(): void {
  _rulesCache = null;
  _rulesCacheDir = null;
}

/**
 * Load all rules from .codebuddy/rules/ directory.
 */
export function loadRules(projectRoot: string = process.cwd()): RuleDefinition[] {
  const rulesDir = path.join(projectRoot, '.codebuddy', 'rules');

  // Return cache if rules dir hasn't changed
  if (_rulesCache && _rulesCacheDir === rulesDir) {
    return _rulesCache;
  }

  const rules: RuleDefinition[] = [];

  if (!fs.existsSync(rulesDir)) {
    _rulesCache = rules;
    _rulesCacheDir = rulesDir;
    return rules;
  }

  try {
    const files = fs.readdirSync(rulesDir).filter(f => f.endsWith('.md'));

    for (const file of files) {
      const filePath = path.join(rulesDir, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const { meta, body } = parseFrontmatter(raw);

        if (!body.trim()) continue;

        const paths = Array.isArray(meta.paths) ? meta.paths as string[] : [];
        const alwaysApply = meta.alwaysApply === true;

        // Rules must have paths or alwaysApply
        if (paths.length === 0 && !alwaysApply) {
          logger.debug(`Rule ${file} has no paths and alwaysApply=false, skipping`);
          continue;
        }

        // CC9: Resolve @import directives in rule body
        const resolvedBody = resolveImportDirectives(body.trim(), {
          baseDir: rulesDir,
          projectRoot,
        });

        rules.push({
          source: `.codebuddy/rules/${file}`,
          description: typeof meta.description === 'string' ? meta.description : undefined,
          paths,
          alwaysApply,
          content: resolvedBody,
        });

        logger.debug(`Loaded rule: ${file}`, {
          paths: paths.length,
          alwaysApply,
        });
      } catch (err) {
        logger.debug(`Failed to load rule ${file}: ${err}`);
      }
    }
  } catch (err) {
    logger.debug(`Failed to read rules directory: ${err}`);
  }

  _rulesCache = rules;
  _rulesCacheDir = rulesDir;
  return rules;
}

/**
 * Get rules that should always be applied (alwaysApply: true).
 */
export function getAlwaysApplyRules(projectRoot?: string): RuleDefinition[] {
  return loadRules(projectRoot).filter(r => r.alwaysApply);
}

/**
 * Get rules matching a specific file path.
 *
 * @param accessedPath - Absolute or relative file path being accessed
 * @param projectRoot - Project root directory
 * @returns Matching rules (excluding alwaysApply rules, which are separate)
 */
export function getMatchingRules(
  accessedPath: string,
  projectRoot: string = process.cwd(),
): RuleDefinition[] {
  const rules = loadRules(projectRoot);
  const relativePath = path.relative(projectRoot, path.resolve(accessedPath)).replace(/\\/g, '/');

  return rules.filter(rule => {
    if (rule.alwaysApply) return false; // These are handled separately
    return rule.paths.some(pattern => matchGlob(relativePath, pattern));
  });
}

/**
 * Format rules as context string for injection into the LLM prompt.
 */
export function formatRulesContext(rules: RuleDefinition[]): string {
  if (rules.length === 0) return '';

  const sections = rules.map(rule => {
    const header = rule.description
      ? `[Rule: ${rule.description} (${rule.source})]`
      : `[Rule: ${rule.source}]`;
    return `${header}\n${rule.content}`;
  });

  return '\n\n--- Scoped Rules ---\n' + sections.join('\n\n') + '\n--- End Rules ---';
}

// ============================================================================
// Integration with JIT Context
// ============================================================================

/** Set of already-injected rule sources (avoid re-injecting) */
const injectedRules = new Set<string>();

/**
 * Clear injected rules tracking (for testing or session reset).
 */
export function clearInjectedRules(): void {
  injectedRules.clear();
}

/**
 * Discover matching rules for a file access and return formatted context.
 * Only returns rules that haven't been injected yet in this session.
 *
 * @param accessedPath - File path being accessed by a tool
 * @param projectRoot - Project root
 * @returns Formatted rules context string (empty if nothing new)
 */
export function discoverRulesForPath(
  accessedPath: string,
  projectRoot: string = process.cwd(),
): string {
  const matching = getMatchingRules(accessedPath, projectRoot);
  const newRules = matching.filter(r => !injectedRules.has(r.source));

  if (newRules.length === 0) return '';

  // Mark as injected
  for (const rule of newRules) {
    injectedRules.add(rule.source);
  }

  return formatRulesContext(newRules);
}

/**
 * Get initial always-apply rules for session start.
 * Returns rules with alwaysApply: true that haven't been injected yet.
 */
export function getInitialRulesContext(projectRoot?: string): string {
  const rules = getAlwaysApplyRules(projectRoot);
  const newRules = rules.filter(r => !injectedRules.has(r.source));

  if (newRules.length === 0) return '';

  for (const rule of newRules) {
    injectedRules.add(rule.source);
  }

  return formatRulesContext(newRules);
}
