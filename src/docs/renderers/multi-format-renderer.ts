/**
 * Multi-Format Renderer — dispatches RenderInput to format-specific renderers.
 *
 * Converts docs pipeline markdown pages into HTML, JSON, and Wiki formats.
 * All output is self-contained (no external dependencies).
 */

import { logger } from '../../utils/logger.js';
import { HtmlThemeEngine } from './html-theme.js';
import { WikiGenerator } from './wiki-generator.js';
import { slug } from './types.js';
import type { OutputFormat, RenderInput, RenderOutput } from './types.js';

// Re-export types for backward compatibility (other files import from here)
export type { OutputFormat, RenderInput, RenderOutput } from './types.js';
export { slug } from './types.js';

// ============================================================================
// Core Renderer
// ============================================================================

export class MultiFormatRenderer {
  /**
   * Render as Markdown with YAML frontmatter.
   */
  static toMarkdown(input: RenderInput): RenderOutput {
    const date = input.generatedAt ?? new Date().toISOString();
    const frontmatter = [
      '---',
      `title: "${input.title.replace(/"/g, '\\"')}"`,
      `module: "${input.moduleId}"`,
      `cohesion: ${input.cohesion.toFixed(2)}`,
      `members: ${input.members.length}`,
      `generated: "${date}"`,
      '---',
      '',
    ].join('\n');

    const content = frontmatter + input.markdown;
    const filename = `${MultiFormatRenderer.slug(input.moduleId)}.md`;

    return {
      format: 'markdown',
      content,
      filename,
      sizeBytes: Buffer.byteLength(content, 'utf-8'),
    };
  }

  /**
   * Render as a self-contained HTML page with sidebar, TOC, theme toggle.
   */
  static toHtml(input: RenderInput, allModules: RenderInput[]): RenderOutput {
    const content = HtmlThemeEngine.render(input, allModules);
    const filename = `${MultiFormatRenderer.slug(input.moduleId)}.html`;

    return {
      format: 'html',
      content,
      filename,
      sizeBytes: Buffer.byteLength(content, 'utf-8'),
    };
  }

  /**
   * Render as structured JSON with sections extracted from H2 headings.
   */
  static toJson(input: RenderInput): RenderOutput {
    const sections = MultiFormatRenderer.extractSections(input.markdown);

    const data = {
      id: input.moduleId,
      title: input.title,
      cohesion: input.cohesion,
      members: input.members,
      filePaths: input.filePaths,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      sections,
    };

    const content = JSON.stringify(data, null, 2);
    const filename = `${MultiFormatRenderer.slug(input.moduleId)}.json`;

    return {
      format: 'json',
      content,
      filename,
      sizeBytes: Buffer.byteLength(content, 'utf-8'),
    };
  }

  /**
   * Render as Wiki format: page + index + search index.
   * Returns an array of outputs.
   */
  static toWiki(input: RenderInput, allModules: RenderInput[]): RenderOutput[] {
    return WikiGenerator.generate(input, allModules);
  }

  /**
   * Build a README.md index listing all modules with links to each format.
   */
  static buildIndex(modules: RenderInput[], formats: OutputFormat[], repoName: string): string {
    const lines: string[] = [
      `# ${repoName} — Documentation`,
      '',
      `> Generated on ${new Date().toISOString().split('T')[0]}`,
      '',
      `| Module | Cohesion | Members | ${formats.map(f => f.charAt(0).toUpperCase() + f.slice(1)).join(' | ')} |`,
      `| ------ | -------: | ------: | ${formats.map(() => '------').join(' | ')} |`,
    ];

    for (const mod of modules) {
      const slug = MultiFormatRenderer.slug(mod.moduleId);
      const links = formats.map(f => {
        const ext = f === 'markdown' ? 'md' : f === 'wiki' ? 'html' : f;
        const dir = f === 'wiki' ? 'wiki/' : '';
        return `[${f}](${dir}${slug}.${ext})`;
      });
      lines.push(
        `| **${mod.title}** | ${mod.cohesion.toFixed(2)} | ${mod.members.length} | ${links.join(' | ')} |`,
      );
    }

    lines.push('');
    return lines.join('\n');
  }

  /**
   * Create a URL-safe slug from an identifier.
   */
  static slug(id: string): string {
    return id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  /**
   * Split markdown content into named sections keyed by H2 headings.
   * Content before the first H2 is stored under "_intro".
   */
  static extractSections(markdown: string): Record<string, string> {
    const sections: Record<string, string> = {};

    // Strip YAML frontmatter
    let body = markdown;
    if (body.startsWith('---')) {
      const endIdx = body.indexOf('---', 3);
      if (endIdx !== -1) {
        body = body.slice(endIdx + 3).trimStart();
      }
    }

    const lines = body.split('\n');
    let currentKey = '_intro';
    let buffer: string[] = [];

    for (const line of lines) {
      const h2Match = line.match(/^##\s+(.+)$/);
      const heading = h2Match?.[1];
      if (heading !== undefined) {
        // Flush previous section
        if (buffer.length > 0 || currentKey !== '_intro') {
          const text = buffer.join('\n').trim();
          if (text) {
            sections[currentKey] = text;
          }
        }
        currentKey = heading.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        buffer = [];
      } else {
        buffer.push(line);
      }
    }

    // Flush last section
    const lastText = buffer.join('\n').trim();
    if (lastText) {
      sections[currentKey] = lastText;
    }

    return sections;
  }
}
