/**
 * HTML Theme Engine — self-contained HTML renderer with professional theme.
 *
 * Produces a complete HTML page with:
 *   - Sidebar navigation (all modules, active highlighted, cohesion bars)
 *   - Table of contents with scroll spy
 *   - Dark/light theme toggle
 *   - Basic syntax highlighting for code blocks
 *   - Search box that filters sidebar items
 *   - Responsive layout (sidebar hidden below 900px)
 *   - All CSS/JS inline — no external dependencies
 *
 * Colors: accent #1D9E75 (teal), bg #ffffff/#1a1a2e (light/dark)
 */

import type { RenderInput } from './types.js';
import { slug } from './types.js';

// ============================================================================
// HTML Theme Engine
// ============================================================================

export class HtmlThemeEngine {
  /**
   * Render a full self-contained HTML page for the given module.
   */
  static render(input: RenderInput, allModules: RenderInput[]): string {
    const moduleSlug = slug(input.moduleId);
    const bodyHtml = HtmlThemeEngine.mdToHtml(input.markdown);
    const headings = HtmlThemeEngine.extractHeadings(input.markdown);
    const navItems = HtmlThemeEngine.buildNavItems(allModules, moduleSlug);
    const tocItems = HtmlThemeEngine.buildTocItems(headings);

    return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${HtmlThemeEngine.escapeHtml(input.title)}</title>
<style>
${HtmlThemeEngine.getStyles()}
</style>
</head>
<body>
<aside class="sidebar" id="sidebar">
  <div class="sidebar-header">
    <span class="logo">Docs</span>
    <button class="theme-toggle" id="themeToggle" title="Toggle theme" aria-label="Toggle theme">
      <span class="icon-sun">&#9728;</span>
      <span class="icon-moon">&#9790;</span>
    </button>
  </div>
  <div class="sidebar-search">
    <input type="text" id="searchBox" placeholder="Search modules..." aria-label="Search modules">
  </div>
  <nav class="sidebar-nav" id="sidebarNav">
    ${navItems}
  </nav>
</aside>
<main class="content">
  <button class="menu-btn" id="menuBtn" aria-label="Toggle sidebar">&#9776;</button>
  <article class="article">
    <h1>${HtmlThemeEngine.escapeHtml(input.title)}</h1>
    <div class="meta">
      <span>Module: <code>${HtmlThemeEngine.escapeHtml(input.moduleId)}</code></span>
      <span>Cohesion: <strong>${input.cohesion.toFixed(2)}</strong></span>
      <span>Members: <strong>${input.members.length}</strong></span>
    </div>
    ${bodyHtml}
  </article>
</main>
<aside class="toc" id="toc">
  <div class="toc-title">On this page</div>
  <nav>
    ${tocItems}
  </nav>
</aside>
<script>
${HtmlThemeEngine.getScript()}
</script>
</body>
</html>`;
  }

  /**
   * Convert markdown to HTML without external dependencies.
   *
   * Handles: code blocks, inline code, headings (h1-h4), bold, italic,
   * links, unordered/ordered lists, tables, blockquotes, paragraphs.
   * YAML frontmatter is stripped.
   */
  static mdToHtml(md: string): string {
    let text = md;

    // Strip YAML frontmatter
    if (text.startsWith('---')) {
      const endIdx = text.indexOf('---', 3);
      if (endIdx !== -1) {
        text = text.slice(endIdx + 3).trimStart();
      }
    }

    // Fenced code blocks — must be processed first to protect content
    const codeBlocks: string[] = [];
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang: string, code: string) => {
      const highlighted = HtmlThemeEngine.highlightSyntax(HtmlThemeEngine.escapeHtml(code.trimEnd()), lang);
      const langClass = lang ? ` class="lang-${HtmlThemeEngine.escapeHtml(lang)}"` : '';
      const placeholder = `%%CODEBLOCK_${codeBlocks.length}%%`;
      codeBlocks.push(`<pre><code${langClass}>${highlighted}</code></pre>`);
      return placeholder;
    });

    // Tables
    text = HtmlThemeEngine.convertTables(text);

    // Blockquotes
    text = text.replace(/^((?:>\s?.*\n?)+)/gm, (block) => {
      const inner = block.replace(/^>\s?/gm, '').trim();
      return `<blockquote>${inner}</blockquote>\n`;
    });

    // Headings (h1-h4) — generate id anchors
    text = text.replace(/^(#{1,4})\s+(.+)$/gm, (_match, hashes: string, content: string) => {
      const level = hashes.length;
      const id = content.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      return `<h${level} id="${id}">${HtmlThemeEngine.inlineMarkdown(content.trim())}</h${level}>`;
    });

    // Unordered lists
    text = HtmlThemeEngine.convertLists(text);

    // Ordered lists
    text = HtmlThemeEngine.convertOrderedLists(text);

    // Inline elements in remaining lines
    const lines = text.split('\n');
    const result: string[] = [];
    let inParagraph = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Restore code blocks
      if (trimmed.startsWith('%%CODEBLOCK_')) {
        if (inParagraph) { result.push('</p>'); inParagraph = false; }
        const idx = parseInt(trimmed.replace('%%CODEBLOCK_', '').replace('%%', ''), 10);
        result.push(codeBlocks[idx] ?? trimmed);
        continue;
      }

      // Skip already-processed HTML tags
      if (trimmed.startsWith('<h') || trimmed.startsWith('<blockquote') ||
          trimmed.startsWith('<table') || trimmed.startsWith('<ul') ||
          trimmed.startsWith('<ol') || trimmed.startsWith('</')) {
        if (inParagraph) { result.push('</p>'); inParagraph = false; }
        result.push(line);
        continue;
      }

      // Blank line breaks paragraphs
      if (trimmed === '') {
        if (inParagraph) { result.push('</p>'); inParagraph = false; }
        continue;
      }

      // Horizontal rule
      if (/^[-*_]{3,}$/.test(trimmed)) {
        if (inParagraph) { result.push('</p>'); inParagraph = false; }
        result.push('<hr>');
        continue;
      }

      // Regular text — wrap in paragraphs
      const processed = HtmlThemeEngine.inlineMarkdown(trimmed);
      if (!inParagraph) {
        result.push('<p>');
        inParagraph = true;
      }
      result.push(processed);
    }
    if (inParagraph) result.push('</p>');

    return result.join('\n');
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /** Apply inline markdown: bold, italic, inline code, links */
  private static inlineMarkdown(text: string): string {
    let out = text;
    // Inline code (before bold/italic to avoid interference)
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold + italic
    out = out.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    // Bold
    out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    out = out.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Links [text](url)
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return out;
  }

  /** Convert markdown tables to HTML */
  private static convertTables(text: string): string {
    return text.replace(
      /((?:\|[^\n]+\|(?:\n|$)){2,})/g,
      (block) => {
        const rows = block.trim().split('\n').filter(r => r.trim());
        if (rows.length < 2) return block;

        const parseRow = (row: string): string[] =>
          row.split('|').map(c => c.trim()).filter((c, i, arr) => i > 0 && i < arr.length - 1);

        const headerRow = rows[0];
        const separatorRow = rows[1];
        if (headerRow === undefined || separatorRow === undefined) return block;

        // Check if second row is separator
        const sep = parseRow(separatorRow);
        const isSep = sep.every(c => /^[-:]+$/.test(c));
        if (!isSep) return block;

        const headerCells = parseRow(headerRow);
        const thead = `<thead><tr>${headerCells.map(c => `<th>${HtmlThemeEngine.inlineMarkdown(c)}</th>`).join('')}</tr></thead>`;

        const bodyRows = rows.slice(2);
        const tbody = bodyRows.map(row => {
          const cells = parseRow(row);
          return `<tr>${cells.map(c => `<td>${HtmlThemeEngine.inlineMarkdown(c)}</td>`).join('')}</tr>`;
        }).join('\n');

        return `<table>${thead}<tbody>${tbody}</tbody></table>\n`;
      },
    );
  }

  /** Convert unordered lists (- or * prefixed lines) */
  private static convertLists(text: string): string {
    return text.replace(
      /((?:^[ \t]*[-*]\s+.+\n?)+)/gm,
      (block) => {
        const items = block.trim().split('\n').map(line => {
          const content = line.replace(/^[ \t]*[-*]\s+/, '');
          return `<li>${HtmlThemeEngine.inlineMarkdown(content)}</li>`;
        });
        return `<ul>\n${items.join('\n')}\n</ul>\n`;
      },
    );
  }

  /** Convert ordered lists (1. prefixed lines) */
  private static convertOrderedLists(text: string): string {
    return text.replace(
      /((?:^[ \t]*\d+\.\s+.+\n?)+)/gm,
      (block) => {
        const items = block.trim().split('\n').map(line => {
          const content = line.replace(/^[ \t]*\d+\.\s+/, '');
          return `<li>${HtmlThemeEngine.inlineMarkdown(content)}</li>`;
        });
        return `<ol>\n${items.join('\n')}\n</ol>\n`;
      },
    );
  }

  /** Extract H2/H3 headings for TOC */
  private static extractHeadings(md: string): Array<{ level: number; text: string; id: string }> {
    const headings: Array<{ level: number; text: string; id: string }> = [];
    const lines = md.split('\n');
    for (const line of lines) {
      const m = line.match(/^(#{2,3})\s+(.+)$/);
      if (m && m[1] !== undefined && m[2] !== undefined) {
        const text = m[2].trim();
        const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        headings.push({ level: m[1].length, text, id });
      }
    }
    return headings;
  }

  /** Build sidebar navigation HTML from all modules */
  private static buildNavItems(allModules: RenderInput[], activeSlug: string): string {
    return allModules.map(mod => {
      const s = slug(mod.moduleId);
      const active = s === activeSlug ? ' class="active"' : '';
      const barWidth = Math.round(mod.cohesion * 100);
      return `<a href="${s}.html"${active} data-title="${HtmlThemeEngine.escapeHtml(mod.title.toLowerCase())}">
      <span class="nav-title">${HtmlThemeEngine.escapeHtml(mod.title)}</span>
      <span class="cohesion-bar"><span class="cohesion-fill" style="width:${barWidth}%"></span></span>
    </a>`;
    }).join('\n    ');
  }

  /** Build TOC HTML from headings */
  private static buildTocItems(headings: Array<{ level: number; text: string; id: string }>): string {
    return headings.map(h => {
      const indent = h.level === 3 ? ' class="toc-sub"' : '';
      return `<a href="#${h.id}"${indent} data-target="${h.id}">${HtmlThemeEngine.escapeHtml(h.text)}</a>`;
    }).join('\n    ');
  }

  /** Basic syntax highlighting for code blocks */
  private static highlightSyntax(code: string, lang: string): string {
    if (!lang) return code;

    // Keywords per language family
    const keywordSets: Record<string, string[]> = {
      typescript: ['import', 'export', 'const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'new', 'this', 'extends', 'implements', 'async', 'await', 'try', 'catch', 'throw', 'default', 'from', 'of', 'in', 'as', 'readonly', 'static', 'private', 'public', 'protected', 'abstract'],
      javascript: ['import', 'export', 'const', 'let', 'var', 'function', 'class', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'new', 'this', 'extends', 'async', 'await', 'try', 'catch', 'throw', 'default', 'from', 'of', 'in'],
      python: ['import', 'from', 'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'raise', 'with', 'as', 'in', 'not', 'and', 'or', 'is', 'None', 'True', 'False', 'self', 'async', 'await', 'yield', 'lambda', 'pass', 'break', 'continue'],
      rust: ['fn', 'let', 'mut', 'const', 'struct', 'enum', 'impl', 'trait', 'pub', 'use', 'mod', 'if', 'else', 'match', 'for', 'while', 'loop', 'return', 'self', 'Self', 'async', 'await', 'move', 'where', 'type', 'unsafe', 'extern', 'crate'],
      go: ['func', 'var', 'const', 'type', 'struct', 'interface', 'package', 'import', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break', 'continue', 'go', 'defer', 'select', 'chan', 'map', 'make', 'new', 'nil', 'true', 'false'],
    };

    // Alias common language names
    const aliases: Record<string, string> = {
      ts: 'typescript', js: 'javascript', py: 'python', rs: 'rust',
      tsx: 'typescript', jsx: 'javascript',
    };

    const resolvedLang = aliases[lang] ?? lang;
    const keywords = keywordSets[resolvedLang];
    if (!keywords) return code;

    let result = code;

    // Highlight strings (single/double quoted)
    result = result.replace(/(["'])(?:(?!\1|\\).|\\.)*\1/g, '<span class="hl-str">$&</span>');

    // Highlight single-line comments
    result = result.replace(/(\/\/[^\n]*)/g, '<span class="hl-cmt">$1</span>');

    // Highlight keywords (word boundaries, not inside already-tagged spans)
    const kwPattern = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g');
    result = result.replace(kwPattern, (match) => {
      return `<span class="hl-kw">${match}</span>`;
    });

    // Highlight numbers
    result = result.replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-num">$1</span>');

    return result;
  }

  /** Escape HTML special characters */
  static escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // --------------------------------------------------------------------------
  // Inline CSS
  // --------------------------------------------------------------------------

  private static getStyles(): string {
    return `
:root {
  --accent: #1D9E75;
  --accent-hover: #178a64;
  --bg: #ffffff;
  --bg-secondary: #f5f7fa;
  --bg-code: #f0f2f5;
  --text: #1a1a2e;
  --text-secondary: #555;
  --border: #e0e0e0;
  --sidebar-bg: #fafbfc;
  --sidebar-width: 260px;
  --toc-width: 220px;
}

[data-theme="dark"] {
  --bg: #1a1a2e;
  --bg-secondary: #22223a;
  --bg-code: #2a2a42;
  --text: #e0e0e0;
  --text-secondary: #aaa;
  --border: #333;
  --sidebar-bg: #16162a;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: var(--text);
  background: var(--bg);
  display: flex;
  min-height: 100vh;
  line-height: 1.65;
}

/* ---- Sidebar ---- */
.sidebar {
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  overflow-y: auto;
  z-index: 100;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}

.logo {
  font-weight: 700;
  font-size: 18px;
  color: var(--accent);
}

.theme-toggle {
  background: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  padding: 4px 8px;
  font-size: 16px;
  color: var(--text);
}

[data-theme="light"] .icon-moon { display: none; }
[data-theme="dark"] .icon-sun { display: none; }

.sidebar-search {
  padding: 10px 14px;
}

.sidebar-search input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
  outline: none;
}

.sidebar-search input:focus {
  border-color: var(--accent);
}

.sidebar-nav {
  flex: 1;
  padding: 6px 0;
  overflow-y: auto;
}

.sidebar-nav a {
  display: block;
  padding: 8px 18px;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 13px;
  border-left: 3px solid transparent;
  transition: all 0.15s;
}

.sidebar-nav a:hover {
  background: var(--bg-secondary);
  color: var(--text);
}

.sidebar-nav a.active {
  border-left-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
  background: var(--bg-secondary);
}

.sidebar-nav a[hidden] { display: none; }

.nav-title { display: block; }

.cohesion-bar {
  display: block;
  height: 3px;
  background: var(--border);
  border-radius: 2px;
  margin-top: 4px;
}

.cohesion-fill {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
}

/* ---- Content ---- */
.content {
  flex: 1;
  margin-left: var(--sidebar-width);
  margin-right: var(--toc-width);
  padding: 40px 48px;
  max-width: 900px;
  min-width: 0;
}

.menu-btn {
  display: none;
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 200;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 20px;
  cursor: pointer;
  color: var(--text);
}

.article h1 {
  font-size: 28px;
  margin-bottom: 8px;
  color: var(--text);
}

.meta {
  display: flex;
  gap: 20px;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 32px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}

.article h2 {
  font-size: 22px;
  margin: 36px 0 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}

.article h3 {
  font-size: 18px;
  margin: 28px 0 8px;
  color: var(--text);
}

.article h4 {
  font-size: 15px;
  margin: 20px 0 6px;
  color: var(--text-secondary);
}

.article p { margin: 10px 0; }

.article a { color: var(--accent); text-decoration: none; }
.article a:hover { text-decoration: underline; }

.article code {
  background: var(--bg-code);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}

.article pre {
  background: var(--bg-code);
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 14px 0;
  border: 1px solid var(--border);
}

.article pre code {
  background: none;
  padding: 0;
  font-size: 13px;
  line-height: 1.5;
}

.hl-kw { color: #c678dd; font-weight: 600; }
.hl-str { color: #98c379; }
.hl-cmt { color: #7f848e; font-style: italic; }
.hl-num { color: #d19a66; }

[data-theme="light"] .hl-kw { color: #8b3dba; }
[data-theme="light"] .hl-str { color: #2e7d32; }
[data-theme="light"] .hl-cmt { color: #9e9e9e; }
[data-theme="light"] .hl-num { color: #b5651d; }

.article table {
  border-collapse: collapse;
  width: 100%;
  margin: 14px 0;
  font-size: 14px;
}

.article th, .article td {
  border: 1px solid var(--border);
  padding: 8px 12px;
  text-align: left;
}

.article th {
  background: var(--bg-secondary);
  font-weight: 600;
}

.article blockquote {
  border-left: 4px solid var(--accent);
  padding: 8px 16px;
  margin: 12px 0;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border-radius: 0 6px 6px 0;
}

.article ul, .article ol {
  padding-left: 24px;
  margin: 10px 0;
}

.article li { margin: 4px 0; }

.article hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 24px 0;
}

/* ---- TOC ---- */
.toc {
  width: var(--toc-width);
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  padding: 24px 14px;
  overflow-y: auto;
  border-left: 1px solid var(--border);
  background: var(--bg);
}

.toc-title {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
  margin-bottom: 12px;
  font-weight: 600;
}

.toc a {
  display: block;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--text-secondary);
  text-decoration: none;
  border-left: 2px solid transparent;
  transition: all 0.15s;
}

.toc a:hover { color: var(--text); }

.toc a.active {
  color: var(--accent);
  border-left-color: var(--accent);
  font-weight: 600;
}

.toc a.toc-sub { padding-left: 20px; font-size: 11px; }

/* ---- Responsive ---- */
@media (max-width: 1200px) {
  .toc { display: none; }
  .content { margin-right: 0; }
}

@media (max-width: 900px) {
  .sidebar { transform: translateX(-100%); transition: transform 0.25s; }
  .sidebar.open { transform: translateX(0); }
  .content { margin-left: 0; padding: 24px 20px; }
  .menu-btn { display: block; }
}
`;
  }

  // --------------------------------------------------------------------------
  // Inline JS
  // --------------------------------------------------------------------------

  private static getScript(): string {
    return `
(function() {
  // Theme toggle
  var html = document.documentElement;
  var saved = localStorage.getItem('docs-theme');
  if (saved) html.setAttribute('data-theme', saved);
  else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    html.setAttribute('data-theme', 'dark');
  }

  document.getElementById('themeToggle').addEventListener('click', function() {
    var current = html.getAttribute('data-theme');
    var next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('docs-theme', next);
  });

  // Sidebar search
  var searchBox = document.getElementById('searchBox');
  var navLinks = document.querySelectorAll('#sidebarNav a');
  searchBox.addEventListener('input', function() {
    var q = this.value.toLowerCase();
    navLinks.forEach(function(link) {
      var title = link.getAttribute('data-title') || '';
      link.hidden = q && title.indexOf(q) === -1;
    });
  });

  // Mobile menu
  var menuBtn = document.getElementById('menuBtn');
  var sidebar = document.getElementById('sidebar');
  menuBtn.addEventListener('click', function() {
    sidebar.classList.toggle('open');
  });

  // TOC scroll spy
  var tocLinks = document.querySelectorAll('#toc a[data-target]');
  if (tocLinks.length > 0) {
    var headingEls = [];
    tocLinks.forEach(function(link) {
      var el = document.getElementById(link.getAttribute('data-target'));
      if (el) headingEls.push({ el: el, link: link });
    });

    function updateToc() {
      var scrollY = window.scrollY + 80;
      var active = null;
      for (var i = headingEls.length - 1; i >= 0; i--) {
        if (headingEls[i].el.offsetTop <= scrollY) { active = headingEls[i]; break; }
      }
      tocLinks.forEach(function(l) { l.classList.remove('active'); });
      if (active) active.link.classList.add('active');
    }

    window.addEventListener('scroll', updateToc, { passive: true });
    updateToc();
  }
})();
`;
  }
}
