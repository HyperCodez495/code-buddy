/**
 * Phase 4 — Concept Linker
 *
 * After all pages are generated, this module:
 * 1. Builds a concept index from all page titles and H2/H3 headings
 * 2. Links first mentions of known concepts to their definition pages
 * 3. Adds "See also" footers with contextual descriptions
 * 4. Adds "Referenced by" footers on definition pages
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DocPlan } from '../planning/plan-generator.js';
import type { GeneratedPage } from '../generation/page-generator.js';

// ============================================================================
// Types
// ============================================================================

export interface ConceptEntry {
  concept: string;
  pageSlug: string;
  file: string;
  anchor: string;
  description: string;
}

// ============================================================================
// Alias & Stem Support
// ============================================================================

const CONCEPT_ALIASES: Record<string, string[]> = {
  'auth': ['authentication', 'authorization', 'authn', 'authz'],
  'config': ['configuration', 'settings'],
  'ctx': ['context'],
  'middleware': ['middlewares'],
  'plugin': ['plugins', 'extensions'],
  'agent': ['agents'],
  'tool': ['tools'],
  'session': ['sessions'],
  'provider': ['providers'],
  'command': ['commands'],
  'channel': ['channels'],
};

/** Build regex variants for a concept: exact + plural forms */
function buildConceptRegex(concept: string): RegExp {
  const escaped = concept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match exact or with trailing s/es/ies
  return new RegExp('\\b(' + escaped + '(?:s|es)?)\\b', 'i');
}

/** Check if an alias of the concept exists in text */
function findAliasMatch(concept: string, content: string): RegExpMatchArray | null {
  const lc = concept.toLowerCase();
  for (const [key, aliases] of Object.entries(CONCEPT_ALIASES)) {
    const allForms = [key, ...aliases];
    if (!allForms.includes(lc)) continue;
    // Try all alias forms
    for (const alias of allForms) {
      if (alias === lc) continue; // skip self
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp('\\b(' + escaped + ')\\b', 'i');
      const match = content.match(regex);
      if (match) return match;
    }
  }
  return null;
}

// ============================================================================
// Concept Index Builder
// ============================================================================

/**
 * Build concept index from generated pages.
 * Extracts page titles + H2/H3 headings + class/function names.
 */
export function buildConceptIndex(
  plan: DocPlan,
  pages: GeneratedPage[],
): ConceptEntry[] {
  const entries: ConceptEntry[] = [];
  const seen = new Set<string>();

  // First pass: page titles take priority over H2 headings
  for (const { page } of pages) {
    if (!seen.has(page.title.toLowerCase())) {
      seen.add(page.title.toLowerCase());
      entries.push({
        concept: page.title,
        pageSlug: page.slug,
        file: `${page.slug}.md`,
        anchor: '',
        description: page.description,
      });
    }
  }

  // Second pass: H2 headings as sub-concepts (page titles already claimed)
  for (const { page, content } of pages) {
    for (const match of content.matchAll(/^## (.+)$/gm)) {
      const captured = match[1];
      if (captured === undefined) continue;
      const heading = captured.replace(/\s*\(.*\)$/, '').trim();
      if (heading.length < 3 || heading.length > 60) continue;
      if (seen.has(heading.toLowerCase())) continue;
      // Skip generic headings
      if (/^(overview|summary|introduction|sources|see also|relevant|referenced by)/i.test(heading)) continue;
      seen.add(heading.toLowerCase());
      const anchor = heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      entries.push({
        concept: heading,
        pageSlug: page.slug,
        file: `${page.slug}.md`,
        anchor,
        description: '',
      });
    }
  }

  // Sort by concept length descending (longer concepts first to avoid partial matches)
  entries.sort((a, b) => b.concept.length - a.concept.length);

  return entries;
}

// ============================================================================
// Linker
// ============================================================================

/**
 * Link concepts across all generated pages.
 * First mention of each concept in a page becomes a hyperlink.
 * Adds "See also" and "Referenced by" footers.
 */
export function linkConcepts(
  outputDir: string,
  pages: GeneratedPage[],
  concepts: ConceptEntry[],
): number {
  let totalLinked = 0;
  // Track which pages link to which for bidirectional refs
  const referencedBy = new Map<string, Set<string>>(); // slug → set of slugs that reference it

  for (const genPage of pages) {
    const page = genPage.page;
    const filePath = path.join(outputDir, `${page.slug}.md`);
    if (!fs.existsSync(filePath)) continue;

    let content = fs.readFileSync(filePath, 'utf-8');
    const linkedInThisPage = new Set<string>();

    for (const concept of concepts) {
      // Don't link to self
      if (concept.pageSlug === page.slug) continue;
      // Only first occurrence per page
      if (linkedInThisPage.has(concept.concept)) continue;

      // Try exact/plural match first
      const regex = buildConceptRegex(concept.concept);
      let match = content.match(regex);

      // Fallback: try alias match
      if (!match) {
        match = findAliasMatch(concept.concept, content);
      }

      if (match && match.index !== undefined) {
        // Get the current line for context
        const lineStart = content.lastIndexOf('\n', match.index - 1);
        const lineEnd = content.indexOf('\n', match.index);
        const currentLine = content.substring(lineStart + 1, lineEnd === -1 ? content.length : lineEnd);
        const posInLine = match.index - lineStart - 1;

        // Don't link inside H1 titles
        if (currentLine.startsWith('# ')) continue;
        // Don't link inside table header rows (| Header | ... |)
        if (currentLine.startsWith('|') && /^\|[\s-|]+\|$/.test(content.substring(lineEnd + 1, content.indexOf('\n', lineEnd + 1)))) continue;
        // Don't link inside code blocks (backtick spans on the current line)
        const beforeOnLine = currentLine.substring(0, posInLine);
        const backtickCount = (beforeOnLine.match(/`/g) ?? []).length;
        if (backtickCount % 2 === 1) continue;
        // Don't link inside existing markdown links [text](url)
        const lastOpenBracket = beforeOnLine.lastIndexOf('[');
        const lastCloseBracket = beforeOnLine.lastIndexOf(']');
        if (lastOpenBracket > lastCloseBracket) continue; // inside link text [...]
        // Don't link inside link URL ](...)
        const lastLinkOpen = beforeOnLine.lastIndexOf('](');
        const lastParen = beforeOnLine.lastIndexOf(')');
        if (lastLinkOpen !== -1 && lastLinkOpen > lastParen) continue;
        // Don't link inside code fences
        const contentBefore = content.substring(0, match.index);
        const fenceOpens = (contentBefore.match(/```/g) ?? []).length;
        if (fenceOpens % 2 === 1) continue;
        // Don't link inside HTML tags
        const lastLT = beforeOnLine.lastIndexOf('<');
        const lastGT = beforeOnLine.lastIndexOf('>');
        if (lastLT > lastGT) continue;

        const link = concept.anchor
          ? `[${match[1]}](./${concept.file}#${concept.anchor})`
          : `[${match[1]}](./${concept.file})`;

        content = content.substring(0, match.index) + link + content.substring(match.index + match[0].length);
        linkedInThisPage.add(concept.concept);
        totalLinked++;

        // Track bidirectional reference
        if (!referencedBy.has(concept.pageSlug)) {
          referencedBy.set(concept.pageSlug, new Set());
        }
        referencedBy.get(concept.pageSlug)!.add(page.slug);
      }
    }

    // Add "See also" footer with related pages
    let relatedPages = pages
      .filter(p => page.relatedPages.includes(p.page.id) && p.page.slug !== page.slug)
      .slice(0, 4);

    // Fallback: if no related pages found via IDs, use type-based proximity
    if (relatedPages.length === 0) {
      relatedPages = pages
        .filter(p => {
          if (p.page.slug === page.slug) return false;
          // Same parent = sibling
          if (page.parentId && p.page.parentId === page.parentId) return true;
          // Parent-child relationship
          if (p.page.id === page.parentId || p.page.parentId === page.id) return true;
          // Same page type (for subsystem/component pages)
          if (page.pageType === p.page.pageType && (page.pageType === 'subsystem' || page.pageType === 'component')) return true;
          return false;
        })
        .slice(0, 4);
    }

    if (relatedPages.length > 0) {
      const seeAlso = relatedPages.map(p => `[${p.page.title}](./${p.page.slug}.md)`).join(' · ');
      content += `\n\n---\n\n**See also:** ${seeAlso}\n`;
    }

    fs.writeFileSync(filePath, content);
  }

  // Second pass: add "Referenced by" footers on definition pages
  for (const genPage of pages) {
    const page = genPage.page;
    const refs = referencedBy.get(page.slug);
    if (!refs || refs.size === 0) continue;

    const filePath = path.join(outputDir, `${page.slug}.md`);
    if (!fs.existsSync(filePath)) continue;

    let content = fs.readFileSync(filePath, 'utf-8');
    // Don't add if already has "Referenced by"
    if (content.includes('**Referenced by:**')) continue;

    const refPages = pages.filter(p => refs.has(p.page.slug)).slice(0, 6);
    if (refPages.length > 0) {
      const refLinks = refPages.map(p => `[${p.page.title}](./${p.page.slug}.md)`).join(' · ');
      content += `\n\n**Referenced by:** ${refLinks}\n`;
      fs.writeFileSync(filePath, content);
    }
  }

  // Third pass: add prev/next navigation at the bottom of each page
  for (let i = 0; i < pages.length; i++) {
    const genPage = pages[i];
    if (genPage === undefined) continue;
    const filePath = path.join(outputDir, `${genPage.page.slug}.md`);
    if (!fs.existsSync(filePath)) continue;

    let content = fs.readFileSync(filePath, 'utf-8');
    if (content.includes('← Previous') || content.includes('Next →')) continue;

    const prev = i > 0 ? pages[i - 1] : null;
    const next = i < pages.length - 1 ? pages[i + 1] : null;
    const navParts: string[] = [];
    if (prev) navParts.push(`[← Previous: ${prev.page.title}](./${prev.page.slug}.md)`);
    if (next) navParts.push(`[Next: ${next.page.title} →](./${next.page.slug}.md)`);

    if (navParts.length > 0) {
      content += `\n\n---\n${navParts.join(' | ')}\n`;
      fs.writeFileSync(filePath, content);
    }
  }

  return totalLinked;
}
