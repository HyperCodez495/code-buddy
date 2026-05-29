/**
 * Phase 3.5 — Page Validator
 *
 * Post-generation validation that fixes broken cross-links,
 * removes placeholder text, and strips hallucinated citations.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger.js';
import type { GeneratedPage } from '../generation/page-generator.js';

// ============================================================================
// Types
// ============================================================================

export interface ValidationResult {
  brokenLinksFixed: number;
  placeholdersRemoved: number;
  fakeCitationsRemoved: number;
  unclosedFencesFixed: number;
  truncatedContentFixed: number;
}

// ============================================================================
// Validator
// ============================================================================

/**
 * Validate and fix all generated pages:
 * - Fix broken cross-links (target file or anchor doesn't exist)
 * - Remove [Placeholder] text without links
 * - Strip hallucinated academic citations
 */
export function validatePages(
  outputDir: string,
  pages: GeneratedPage[],
): ValidationResult {
  const result: ValidationResult = {
    brokenLinksFixed: 0,
    placeholdersRemoved: 0,
    fakeCitationsRemoved: 0,
    unclosedFencesFixed: 0,
    truncatedContentFixed: 0,
  };

  // Build index of existing files and their headings
  const fileHeadings = new Map<string, Set<string>>();
  for (const page of pages) {
    const filename = `${page.page.slug}.md`;
    const headings = new Set<string>();
    for (const line of page.content.split('\n')) {
      const match = line.match(/^##+ (.+)/);
      const headingText = match?.[1];
      if (headingText !== undefined) {
        // Convert heading to anchor: lowercase, replace spaces with hyphens, strip non-alnum
        const anchor = headingText.trim()
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-');
        headings.add(anchor);
      }
    }
    fileHeadings.set(filename, headings);
  }

  // Also include index.md
  fileHeadings.set('index.md', new Set());

  // Validate each page
  for (const page of pages) {
    const filePath = page.filePath;
    let content = fs.readFileSync(filePath, 'utf-8');
    let changed = false;

    // 1. Fix broken cross-links: [text](./file.md#anchor)
    const linkFixed = content.replace(
      /\[([^\]]+)\]\(\.\/([\w-]+\.md)(?:#([\w-]+))?\)/g,
      (match, text: string, file: string, anchor: string | undefined) => {
        const headings = fileHeadings.get(file);
        if (!headings) {
          // File doesn't exist — replace with plain text
          result.brokenLinksFixed++;
          changed = true;
          return text;
        }
        if (anchor && !headings.has(anchor)) {
          // Anchor doesn't exist — link to file without anchor
          result.brokenLinksFixed++;
          changed = true;
          return `[${text}](./${file})`;
        }
        return match; // link is valid
      },
    );
    content = linkFixed;

    // 2. Remove [Placeholder] / [TODO] / [TBD] / [Guide] without ()
    content = content.replace(/\[(TODO|TBD|FIXME|Placeholder|Guide)[^\]]*\](?!\()/gi, () => {
      result.placeholdersRemoved++;
      changed = true;
      return '';
    });

    // 3. Strip hallucinated academic citations
    // "(Author et al., YYYY)"
    content = content.replace(/\((?:[A-Z][a-z]+ et al\.?,?\s*\d{4})\)/g, () => {
      result.fakeCitationsRemoved++;
      changed = true;
      return '';
    });
    // "(Internal Engineering/Documentation/Research, ...)"
    content = content.replace(/\(Internal (?:Engineering|Documentation|Research)[^)]*\)/gi, () => {
      result.fakeCitationsRemoved++;
      changed = true;
      return '';
    });
    // "(based on Author YYYY)"
    content = content.replace(/\(based on [A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,?\s*\d{4}\)/g, () => {
      result.fakeCitationsRemoved++;
      changed = true;
      return '';
    });

    // 4. Fix unclosed code/mermaid fences
    const fenceCount = (content.match(/```/g) ?? []).length;
    if (fenceCount % 2 !== 0) {
      // Find the last unclosed fence and close it
      content += '\n```\n';
      result.unclosedFencesFixed++;
      changed = true;
    }

    // 5. Fix truncated content (sentence cut mid-word at end of section)
    // Pattern: section ends abruptly without period/newline after a partial word
    content = content.replace(/^(## .+\n[\s\S]*?\S)$/gm, (match) => {
      const lastChar = match[match.length - 1];
      if (lastChar && !/[.!?\n`|>)]/.test(lastChar) && match.length > 50) {
        // Likely truncated — add ellipsis
        result.truncatedContentFixed++;
        changed = true;
        return match + '...';
      }
      return match;
    });

    // Clean up double spaces left by removals
    content = content.replace(/ {2,}/g, ' ');
    // Clean up excessive blank lines (max 2 consecutive)
    content = content.replace(/\n{4,}/g, '\n\n\n');

    // Write back if changed
    if (changed) {
      fs.writeFileSync(filePath, content);
      page.content = content;
    }
  }

  // 4. Verify source file citations exist
  for (const page of pages) {
    let content = fs.readFileSync(page.filePath, 'utf-8');
    let changed = false;

    // Match **Sources:** [file.ts:L1-L100] or [file.ts:L1-L100](link)
    content = content.replace(
      /\*\*Sources?:\*\*\s*\[([^\]]+)\]\([^)]*\)/g,
      (match, citation: string) => {
        // Extract file path from citation like "file.ts:L1-L100"
        const filePart = (citation.split(':')[0] ?? '').trim();
        if (filePart && !fs.existsSync(path.join(process.cwd(), filePart))) {
          result.fakeCitationsRemoved++;
          changed = true;
          return ''; // Remove citation with non-existent file
        }
        return match;
      },
    );

    if (changed) {
      content = content.replace(/ {2,}/g, ' ');
      content = content.replace(/\n{4,}/g, '\n\n\n');
      fs.writeFileSync(page.filePath, content);
      page.content = content;
    }
  }

  const totalFixes = result.brokenLinksFixed + result.placeholdersRemoved + result.fakeCitationsRemoved + result.unclosedFencesFixed + result.truncatedContentFixed;
  if (totalFixes > 0) {
    logger.info(`  Validation: ${result.brokenLinksFixed} broken links, ${result.placeholdersRemoved} placeholders, ${result.fakeCitationsRemoved} fake citations, ${result.unclosedFencesFixed} unclosed fences, ${result.truncatedContentFixed} truncated fixed`);
  }

  return result;
}
