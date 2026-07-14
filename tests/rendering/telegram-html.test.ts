import { describe, expect, it } from 'vitest';
import {
  renderTelegramHtml,
  telegramHtmlChunkToPlain,
} from '../../src/rendering/telegram-html';

const one = (md: string): string => renderTelegramHtml(md).join('\n');

describe('renderTelegramHtml', () => {
  it('converts bold / italic / inline code', () => {
    expect(one('**bold** and _italic_ and `code`')).toBe('<b>bold</b> and <i>italic</i> and <code>code</code>');
  });

  it('renders headings as bold (Telegram has no headings)', () => {
    expect(one('# Title')).toBe('<b>Title</b>');
  });

  it('wraps fenced code blocks in <pre> and escapes inside', () => {
    const out = one('```\nif (a < b && c > d) {}\n```');
    expect(out).toBe('<pre>if (a &lt; b &amp;&amp; c &gt; d) {}</pre>');
  });

  it('escapes &, <, > in prose text', () => {
    expect(one('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
  });

  it('renders a markdown table as an aligned monospace <pre>', () => {
    const md = '| Model | Score |\n|---|---|\n| gpt | 0.9 |\n| grok | 1.0 |';
    const out = one(md);
    expect(out.startsWith('<pre>')).toBe(true);
    expect(out.endsWith('</pre>')).toBe(true);
    // columns padded to equal width → "Model" (5) and "gpt  " aligned
    expect(out).toContain('Model  Score');
    expect(out).toContain('gpt    0.9');
  });

  it('renders a WIDE table as a mobile-friendly vertical record layout', () => {
    const md =
      '| Critère | REST | GraphQL |\n|---|---|---|\n' +
      '| Principe | Plusieurs endpoints (/users, /posts) | Un endpoint unique (/graphql) |';
    const out = one(md);
    expect(out).not.toContain('<pre>'); // too wide for the aligned grid
    expect(out).toContain('<b>Principe</b>'); // first column = bold row title
    expect(out).toContain('REST : Plusieurs endpoints (/users, /posts)');
    expect(out).toContain('GraphQL : Un endpoint unique (/graphql)');
  });

  it('only links safe http(s) hrefs, keeps text otherwise', () => {
    expect(one('[x](https://e.com)')).toBe('<a href="https://e.com">x</a>');
    expect(one('[x](javascript:alert(1))')).toBe('x');
  });

  it('never emits unbalanced tags on weird/partial markdown', () => {
    for (const md of ['**unclosed bold', '_dangling', '`code without end', 'a * b * c', 'plain']) {
      const html = one(md);
      const opens = (html.match(/<(b|i|s|code|pre|a|blockquote)\b/g) || []).length;
      const closes = (html.match(/<\/(b|i|s|code|pre|a|blockquote)>/g) || []).length;
      expect(opens).toBe(closes);
    }
  });

  it('preserves emoji and accented text', () => {
    expect(one('café 🤖 résumé')).toBe('café 🤖 résumé');
  });

  it('recovers the exact visible text of a generated HTML chunk', () => {
    const html = one('**Léa & moi**\n\n`a < b` et [le lien](https://example.com?q=1&x=2)');
    expect(telegramHtmlChunkToPlain(html)).toBe('Léa & moi\n\na < b et le lien');
  });

  it('renders bullet and ordered lists', () => {
    expect(one('- a\n- b')).toBe('• a\n• b');
    expect(one('1. a\n2. b')).toBe('1. a\n2. b');
  });

  it('splits long output into ≤4096-char chunks, each valid', () => {
    const big = Array.from({ length: 400 }, (_, i) => `Line ${i} of a very long answer.`).join('\n\n');
    const chunks = renderTelegramHtml(big);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4096);
  });

  it('splits an oversized code block while keeping each chunk fenced', () => {
    const huge = '```\n' + 'x'.repeat(9000) + '\n```';
    const chunks = renderTelegramHtml(huge);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.startsWith('<pre>')).toBe(true);
      expect(c.endsWith('</pre>')).toBe(true);
      expect(c.length).toBeLessThanOrEqual(4096);
    }
  });

  it('keeps oversized bold blocks balanced in every chunk', () => {
    const chunks = renderTelegramHtml(`**${'é & '.repeat(2_499)}fin**`);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.startsWith('<b>')).toBe(true);
      expect(chunk.endsWith('</b>')).toBe(true);
      expect(chunk.length).toBeLessThanOrEqual(4096);
      expect((chunk.match(/<b>/g) ?? []).length).toBe((chunk.match(/<\/b>/g) ?? []).length);
      expect(chunk).not.toMatch(/&(?:#x?[0-9a-f]*|[a-z]*)?$/i);
    }
  });

  it('reopens a long formatted link instead of splitting its tags', () => {
    const chunks = renderTelegramHtml(`[${'lien '.repeat(2_000)}](https://example.com/path)`);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.startsWith('<a href="https://example.com/path">')).toBe(true);
      expect(chunk.endsWith('</a>')).toBe(true);
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  it('returns an empty array for empty input', () => {
    expect(renderTelegramHtml('')).toEqual([]);
    expect(renderTelegramHtml('   ')).toEqual([]);
  });
});
