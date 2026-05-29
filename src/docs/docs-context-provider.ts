/**
 * Docs Context Provider
 *
 * Makes generated documentation (.codebuddy/docs/) available to the agent
 * at runtime. Lazy-loads and indexes doc pages, then provides:
 * - Per-turn relevant context based on user message keywords
 * - Architecture summary for system prompt injection
 *
 * Mirrors the pattern from code-graph-context-provider.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

// ============================================================================
// Constants
// ============================================================================

const MAX_CONTEXT_CHARS = 1200;
const MAX_ARCHITECTURE_CHARS = 2000;
const MAX_PAGES_RETURNED = 2;
const CACHE_TTL_MS = 60_000;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'about',
  'this', 'that', 'these', 'those', 'it', 'its', 'and', 'or', 'but',
  'not', 'no', 'if', 'then', 'else', 'when', 'how', 'what', 'which',
  'who', 'where', 'why', 'all', 'each', 'every', 'some', 'any', 'my',
  'your', 'our', 'we', 'you', 'they', 'me', 'him', 'her', 'us', 'them',
  'i', 'he', 'she', 'use', 'using', 'used', 'file', 'files', 'code',
]);

// ============================================================================
// Types
// ============================================================================

interface DocsPageEntry {
  slug: string;
  title: string;
  description: string;
  keywords: string[];
  content: string;
  isArchitecture: boolean;
}

// ============================================================================
// Provider
// ============================================================================

class DocsContextProvider {
  private index = new Map<string, DocsPageEntry>();
  private _loaded = false;
  private _loadedAt = 0;
  private _docsDir = '';

  get isLoaded(): boolean { return this._loaded; }

  async loadDocsIndex(cwd?: string): Promise<void> {
    const docsDir = path.join(cwd ?? process.cwd(), '.codebuddy', 'docs');
    this._docsDir = docsDir;

    if (!fs.existsSync(docsDir)) {
      this._loaded = false;
      return;
    }

    this.index.clear();
    const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md') && f !== 'index.md');

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(docsDir, file), 'utf-8');
        const slug = file.replace(/\.md$/, '');

        // Extract title from first H1
        const titleMatch = content.match(/^# (.+)$/m);
        const title = titleMatch?.[1]?.trim() ?? slug;

        // Extract description: first non-empty paragraph after title (skip <details>)
        const afterTitle = content.replace(/^# .+\n/, '').replace(/<details>[\s\S]*?<\/details>\s*/, '');
        const descMatch = afterTitle.match(/^(?!#|\s*$|\|)(.+)/m);
        const description = descMatch?.[1]?.trim().substring(0, 200) ?? '';

        // Extract keywords from title + H2 headings + bold terms
        const keywords: string[] = [];
        // Title words
        for (const w of title.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP_WORDS.has(w))) {
          keywords.push(w);
        }
        // H2 headings
        for (const m of content.matchAll(/^## (.+)$/gm)) {
          const heading = m[1];
          if (heading === undefined) continue;
          for (const w of heading.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP_WORDS.has(w))) {
            keywords.push(w);
          }
        }
        // Bold terms
        for (const m of content.matchAll(/\*\*([^*]+)\*\*/g)) {
          const bold = m[1];
          if (bold === undefined) continue;
          for (const w of bold.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP_WORDS.has(w))) {
            keywords.push(w);
          }
        }

        const isArchitecture = /overview|architecture|key.concept/i.test(slug) ||
          /overview|architecture/i.test(title);

        this.index.set(slug, { slug, title, description, keywords: [...new Set(keywords)], content, isArchitecture });
      } catch { /* skip unreadable files */ }
    }

    this._loaded = this.index.size > 0;
    this._loadedAt = Date.now();
    if (this._loaded) {
      logger.debug(`DocsContextProvider: indexed ${this.index.size} pages from ${docsDir}`);
    }
  }

  /** Synchronous reload for staleness recovery (reuses the same parsing logic) */
  private loadDocsIndexSync(cwd: string): void {
    const docsDir = path.join(cwd, '.codebuddy', 'docs');
    if (!fs.existsSync(docsDir)) return;

    this.index.clear();
    const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md') && f !== 'index.md');

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(docsDir, file), 'utf-8');
        const slug = file.replace(/\.md$/, '');
        const titleMatch = content.match(/^# (.+)$/m);
        const title = titleMatch?.[1]?.trim() ?? slug;
        const afterTitle = content.replace(/^# .+\n/, '').replace(/<details>[\s\S]*?<\/details>\s*/, '');
        const descMatch = afterTitle.match(/^(?!#|\s*$|\|)(.+)/m);
        const description = descMatch?.[1]?.trim().substring(0, 200) ?? '';
        const keywords: string[] = [];
        for (const w of title.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP_WORDS.has(w))) keywords.push(w);
        for (const m of content.matchAll(/^## (.+)$/gm)) {
          const heading = m[1];
          if (heading === undefined) continue;
          for (const w of heading.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP_WORDS.has(w))) keywords.push(w);
        }
        const isArchitecture = /overview|architecture|key.concept/i.test(slug) || /overview|architecture/i.test(title);
        this.index.set(slug, { slug, title, description, keywords: [...new Set(keywords)], content, isArchitecture });
      } catch { /* skip */ }
    }

    this._loaded = this.index.size > 0;
    this._loadedAt = Date.now();
    this._docsDir = docsDir;
  }

  /**
   * Get relevant doc context for a user message.
   * Returns null if no relevant docs found.
   */
  getRelevantContext(message: string, maxChars: number = MAX_CONTEXT_CHARS): string | null {
    if (!this._loaded || this.index.size === 0) return null;

    // Check staleness — reload synchronously if docs were regenerated
    if (Date.now() - this._loadedAt > CACHE_TTL_MS) {
      try {
        const indexFile = path.join(this._docsDir, 'index.md');
        if (fs.existsSync(indexFile)) {
          const mtime = fs.statSync(indexFile).mtimeMs;
          if (mtime > this._loadedAt) {
            this.loadDocsIndexSync(path.dirname(this._docsDir));
          }
        }
      } catch { /* ignore staleness check errors */ }
    }

    // Extract query keywords
    const queryWords = message.toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));

    if (queryWords.length === 0) return null;

    // Score each page
    const scored: Array<{ entry: DocsPageEntry; score: number }> = [];
    for (const entry of this.index.values()) {
      let score = 0;
      const titleLower = entry.title.toLowerCase();
      const descLower = entry.description.toLowerCase();

      for (const word of queryWords) {
        if (titleLower.includes(word)) score += 3;
        if (descLower.includes(word)) score += 2;
        if (entry.keywords.includes(word)) score += 1;
        // Content match (heavier but informative)
        if (entry.content.toLowerCase().includes(word)) score += 0.5;
      }

      if (score > 0) scored.push({ entry, score });
    }

    if (scored.length === 0) return null;

    // Top N pages
    scored.sort((a, b) => b.score - a.score);
    const topPages = scored.slice(0, MAX_PAGES_RETURNED);

    // Only return if the top score is meaningful
    const topPage = topPages[0];
    if (topPage === undefined || topPage.score < 1.5) return null;

    // Build context snippets
    const parts: string[] = [];
    let chars = 0;

    for (const { entry } of topPages) {
      // Find the most relevant H2 section
      const sections = entry.content.split(/(?=^## )/m).filter(s => s.trim());
      let bestSection = '';
      let bestScore = 0;

      for (const section of sections) {
        const sectionLower = section.toLowerCase();
        let sScore = 0;
        for (const word of queryWords) {
          if (sectionLower.includes(word)) sScore++;
        }
        if (sScore > bestScore) {
          bestScore = sScore;
          bestSection = section;
        }
      }

      // Format snippet
      const snippet = bestSection
        ? `### ${entry.title}\n${bestSection.substring(0, 500).trim()}`
        : `### ${entry.title}\n${entry.description}`;

      if (chars + snippet.length > maxChars) {
        if (parts.length === 0) parts.push(snippet.substring(0, maxChars));
        break;
      }
      parts.push(snippet);
      chars += snippet.length;
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
  }

  /**
   * Get architecture summary for system prompt injection.
   * Returns overview + architecture page content, stripped of <details> blocks.
   */
  getArchitectureSummary(maxChars: number = MAX_ARCHITECTURE_CHARS): string {
    if (!this._loaded || this.index.size === 0) return '';

    const archPages = [...this.index.values()]
      .filter(p => p.isArchitecture)
      .sort((a, b) => {
        // Overview first, then architecture, then key-concepts
        const order = (s: string) => s.includes('overview') ? 0 : s.includes('architecture') ? 1 : 2;
        return order(a.slug) - order(b.slug);
      });

    if (archPages.length === 0) return '';

    const parts: string[] = [];
    let chars = 0;

    for (const page of archPages) {
      // Strip <details> blocks and "See also"/"Referenced by" footers
      let content = page.content
        .replace(/<details>[\s\S]*?<\/details>\s*/g, '')
        .replace(/\n---\n\n\*\*(?:See also|Referenced by):\*\*[^\n]*/g, '')
        .trim();

      const available = maxChars - chars;
      if (available <= 100) break;

      if (content.length > available) {
        content = content.substring(0, available - 3) + '...';
      }

      parts.push(content);
      chars += content.length;
    }

    return parts.join('\n\n');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: DocsContextProvider | null = null;

export function getDocsContextProvider(): DocsContextProvider {
  if (!_instance) _instance = new DocsContextProvider();
  return _instance;
}

export function resetDocsContextProvider(): void {
  _instance = null;
}
