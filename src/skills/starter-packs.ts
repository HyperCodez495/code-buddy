/**
 * Starter Pack Helpers
 *
 * Functions for discovering, filtering, and resolving starter pack skills.
 * Starter packs are SKILL.md skills tagged with `starter` or `scaffold`.
 */

import { getSkillRegistry } from './registry.js';
import type { Skill, SkillMatch } from './types.js';

const STARTER_TAG = 'starter';
const SCAFFOLD_TAG = 'scaffold';

/** Check if a skill is a starter pack (has `starter` or `scaffold` tag) */
export function isStarterPack(skill: Skill): boolean {
  return skill.metadata.tags?.some(t => t === STARTER_TAG || t === SCAFFOLD_TAG) ?? false;
}

/** List all starter pack skills, optionally filtered by language */
export function getStarterPacks(language?: string): Skill[] {
  const registry = getSkillRegistry();
  let starters = registry.list({ tags: [STARTER_TAG] });
  if (language) {
    const lang = language.toLowerCase();
    starters = starters.filter(s =>
      s.metadata.name.toLowerCase().includes(lang) ||
      s.metadata.tags?.some(t => t.toLowerCase() === lang)
    );
  }
  return starters.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
}

/** Short keywords that need word-boundary matching to avoid false positives */
const SHORT_KEYWORDS = new Set(['go', 'py', 'rs', 'rb', 'ts', 'js']);

/**
 * Keyword-based fallback for finding a starter pack.
 * Iterates LANGUAGE_ALIASES sorted by key length (longest first) so that
 * "react native" matches before "react" and "next.js" before "next".
 */
export function findStarterByKeyword(query: string): SkillMatch | null {
  const lower = query.toLowerCase();
  const registry = getSkillRegistry();

  // Sort keys longest-first for priority matching
  const sortedKeys = Object.keys(LANGUAGE_ALIASES).sort((a, b) => b.length - a.length);

  for (const key of sortedKeys) {
    let matched = false;
    if (SHORT_KEYWORDS.has(key)) {
      // Word-boundary regex for short keywords to avoid false positives ("google" ≠ "go")
      matched = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower);
    } else {
      matched = lower.includes(key);
    }

    if (matched) {
      const resolved = LANGUAGE_ALIASES[key];
      if (resolved === undefined) continue;
      const skill = registry.get(resolved);
      if (skill) {
        return { skill, confidence: 0.5, reason: `keyword match: "${key}"` };
      }
    }
  }

  return null;
}

/** Find the best starter pack for a natural language query */
export function findStarterPack(query: string): SkillMatch | null {
  const registry = getSkillRegistry();
  // 1. BM25 search (existing path)
  const matches = registry.search({
    query,
    tags: [STARTER_TAG],
    minConfidence: 0.2,
    limit: 1,
  });
  if (matches[0]) return matches[0];
  // 2. Keyword fallback
  return findStarterByKeyword(query);
}

/** Language aliases: map common terms to skill name prefixes */
const LANGUAGE_ALIASES: Record<string, string> = {
  'js': 'typescript', 'javascript': 'typescript', 'ts': 'typescript',
  'node': 'typescript-node', 'react': 'typescript-react', 'next': 'typescript-nextjs',
  'nextjs': 'typescript-nextjs', 'next.js': 'typescript-nextjs',
  'vue': 'typescript-vue', 'svelte': 'typescript-svelte', 'angular': 'typescript-angular',
  'react native': 'typescript-react-native', 'react-native': 'typescript-react-native', 'reactnative': 'typescript-react-native',
  'py': 'python', 'python': 'python',
  'django': 'python-django', 'flask': 'python-flask', 'fastapi': 'python-fastapi',
  'rs': 'rust', 'rust': 'rust', 'axum': 'rust-axum', 'tauri': 'rust-tauri',
  'go': 'go', 'golang': 'go', 'gin': 'go-gin', 'fiber': 'go-fiber',
  'rb': 'ruby', 'ruby': 'ruby', 'rails': 'ruby-rails',
  'php': 'php', 'laravel': 'php-laravel',
  'java': 'java', 'spring': 'java-spring',
  'kotlin': 'kotlin', 'ktor': 'kotlin-ktor',
  'c#': 'csharp-dotnet', 'csharp': 'csharp-dotnet', '.net': 'csharp-dotnet',
  'dotnet': 'csharp-dotnet', 'aspnet': 'csharp-aspnet', 'maui': 'csharp-maui',
  'elixir': 'elixir', 'phoenix': 'elixir-phoenix',
  'swift': 'swift', 'vapor': 'swift-vapor',
  'zig': 'zig',
  'electron': 'typescript-electron', 'expo': 'typescript-react-native',
};

/** Resolve alias to skill name */
export function resolveStarterAlias(input: string): string {
  return LANGUAGE_ALIASES[input.toLowerCase()] ?? input.toLowerCase();
}
