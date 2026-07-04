import { describe, it, expect } from 'vitest';
import {
  compress,
  htmlToMarkdown,
  dedupeRepeatedBlocks,
  looksLikeRawHtml,
  isTokenJuiceEnabled,
  JUICE_MIN_CHARS,
} from '../../src/context/token-juice.js';

describe('token-juice: looksLikeRawHtml', () => {
  it('detects a document-level HTML page', () => {
    expect(looksLikeRawHtml('<!DOCTYPE html><html><body><p>Hi</p></body></html>')).toBe(true);
  });

  it('detects HTML by tag density even without <html>', () => {
    const frag = '<div><p>a</p><a href="x">b</a><span>c</span><ul><li>d</li></ul></div>';
    expect(looksLikeRawHtml(frag)).toBe(true);
  });

  it('does NOT flag already-clean text / markdown', () => {
    expect(looksLikeRawHtml('# Title\n\nSome prose with a <3 heart and one <tag> mention.')).toBe(false);
    expect(looksLikeRawHtml('plain text, no markup at all, nothing to convert here')).toBe(false);
  });

  it('does NOT flag very short strings', () => {
    expect(looksLikeRawHtml('<p>x</p>')).toBe(false);
  });
});

describe('token-juice: htmlToMarkdown', () => {
  it('converts a real HTML snippet to clean markdown and shrinks it', () => {
    const html =
      '<!DOCTYPE html><html><head><style>.a{color:red}</style>' +
      '<script>track()</script></head><body>' +
      '<nav>menu menu menu</nav>' +
      '<h1>Weather Report</h1>' +
      '<p>Today is <strong>sunny</strong> in <a href="https://example.com/paris">Paris</a>.</p>' +
      '<ul><li>Morning: 12C</li><li>Evening: 18C</li></ul>' +
      '<footer>copyright blah</footer></body></html>';

    const { output, savedChars } = htmlToMarkdown(html);

    // Structure preserved
    expect(output).toContain('# Weather Report');
    expect(output).toContain('**sunny**');
    expect(output).toContain('[Paris](https://example.com/paris)');
    expect(output).toContain('- Morning: 12C');
    expect(output).toContain('- Evening: 18C');
    // Non-content noise dropped
    expect(output).not.toContain('track()');
    expect(output).not.toContain('color:red');
    expect(output).not.toContain('<');
    // Key unique data survives (no information loss)
    expect(output).toContain('12C');
    expect(output).toContain('18C');
    expect(output).toContain('Paris');
    // Genuinely smaller
    expect(savedChars).toBeGreaterThan(0);
    expect(output.length).toBeLessThan(html.length);
  });

  it('is an identity no-op on already-clean text (never re-converts markdown)', () => {
    const md = '# Title\n\nThis is clean **markdown** prose that must not be touched.\n';
    const r = htmlToMarkdown(md);
    expect(r.output).toBe(md);
    expect(r.savedChars).toBe(0);
  });

  it('decodes entities and drops anchor-only links to their text', () => {
    const html = '<div><p>Fish &amp; Chips</p><a href="#top">back to top</a>' +
      '<span>1</span><span>2</span><span>3</span></div>';
    const { output } = htmlToMarkdown(html);
    expect(output).toContain('Fish & Chips');
    expect(output).toContain('back to top');
    expect(output).not.toContain('](#top)');
  });
});

describe('token-juice: dedupeRepeatedBlocks', () => {
  it('collapses a run of identical single lines with a count marker', () => {
    const input = ['start', 'WARN retrying connection', 'WARN retrying connection', 'WARN retrying connection', 'WARN retrying connection', 'done'].join('\n');
    const { output, savedChars } = dedupeRepeatedBlocks(input);
    expect(output).toContain('WARN retrying connection\n(× 4 identique)');
    // Unique surrounding info survives
    expect(output).toContain('start');
    expect(output).toContain('done');
    // Only ONE copy of the repeated line remains
    expect(output.match(/WARN retrying connection/g)?.length).toBe(1);
    expect(savedChars).toBeGreaterThan(0);
  });

  it('collapses a back-to-back multi-line block (period > 1)', () => {
    const block = ['Traceback (most recent call last):', '  File "a.py", line 3', 'ValueError: boom'];
    const input = [...block, ...block, ...block, ...block, 'FINAL LINE'].join('\n');
    const { output } = dedupeRepeatedBlocks(input);
    expect(output).toContain('(× 4 identique)');
    expect(output).toContain('FINAL LINE');
    // The 3-line block appears exactly once now
    expect(output.match(/ValueError: boom/g)?.length).toBe(1);
    expect(output.match(/Traceback \(most recent call last\):/g)?.length).toBe(1);
  });

  it('does NOT collapse when there are only 2 copies (below MIN_REPEATS)', () => {
    const input = 'line A\nline A\nline B';
    const r = dedupeRepeatedBlocks(input);
    expect(r.output).toBe(input);
    expect(r.savedChars).toBe(0);
  });

  it('does NOT collapse trivial short units (e.g. lone braces)', () => {
    const input = '}\n}\n}\n}\n}';
    const r = dedupeRepeatedBlocks(input);
    expect(r.output).toBe(input);
    expect(r.savedChars).toBe(0);
  });

  it('preserves distinct near-duplicate lines (exact-only, never fuzzy)', () => {
    const input = ['error code 1', 'error code 1', 'error code 2', 'error code 1'].join('\n');
    const r = dedupeRepeatedBlocks(input);
    // Not 3 consecutive identical → nothing collapsed, all info kept
    expect(r.output).toBe(input);
    expect(r.savedChars).toBe(0);
  });
});

describe('token-juice: compress (composition)', () => {
  it('runs html→md then dedupe and reports which fired', () => {
    const html =
      '<html><body><div><p>hello world para</p></div>' +
      '<div><p>hello world para</p></div>' +
      '<div><p>hello world para</p></div>' +
      '<div><p>hello world para</p></div></body></html>';
    const r = compress(html);
    expect(r.applied).toContain('html→md');
    // After html→md the repeated paragraph lines collapse
    expect(r.output).toContain('(×');
    expect(r.applied).toContain('dedupe');
    expect(r.savedChars).toBeGreaterThan(0);
  });

  it('is identity on incompressible text (0 change, no corruption)', () => {
    const text = 'The quick brown fox jumps over the lazy dog. Unique sentence, nothing repeats.';
    const r = compress(text);
    expect(r.output).toBe(text);
    expect(r.savedChars).toBe(0);
    expect(r.applied).toEqual([]);
  });

  it('respects the html:false / dedupe:false toggles', () => {
    const input = 'x repeated line\nx repeated line\nx repeated line\nx repeated line';
    const noDedupe = compress(input, { dedupe: false });
    expect(noDedupe.output).toBe(input);
    const withDedupe = compress(input, { html: false, dedupe: true });
    expect(withDedupe.output).toContain('(× 4 identique)');
  });
});

describe('token-juice: isTokenJuiceEnabled', () => {
  it('defaults ON when the env var is unset', () => {
    const prev = process.env.CODEBUDDY_TOKEN_JUICE;
    delete process.env.CODEBUDDY_TOKEN_JUICE;
    expect(isTokenJuiceEnabled()).toBe(true);
    if (prev === undefined) delete process.env.CODEBUDDY_TOKEN_JUICE;
    else process.env.CODEBUDDY_TOKEN_JUICE = prev;
  });

  it('is a hard kill-switch on false/0/off/no', () => {
    const prev = process.env.CODEBUDDY_TOKEN_JUICE;
    for (const v of ['false', '0', 'off', 'no', 'FALSE', 'Off']) {
      process.env.CODEBUDDY_TOKEN_JUICE = v;
      expect(isTokenJuiceEnabled()).toBe(false);
    }
    process.env.CODEBUDDY_TOKEN_JUICE = 'true';
    expect(isTokenJuiceEnabled()).toBe(true);
    if (prev === undefined) delete process.env.CODEBUDDY_TOKEN_JUICE;
    else process.env.CODEBUDDY_TOKEN_JUICE = prev;
  });

  it('exposes a sane threshold constant', () => {
    expect(JUICE_MIN_CHARS).toBe(2000);
  });
});

describe('token-juice: wiring semantics (mirrors agent-executor gate)', () => {
  // Faithful copy of the executor gate: enabled + size threshold + web-tool scope.
  const JUICE_WEB_TOOLS = new Set(['web_fetch', 'web_search', 'fetch', 'browser_fetch']);
  function gatedCompress(toolName: string, output: string): string {
    if (
      isTokenJuiceEnabled() &&
      output.length > JUICE_MIN_CHARS &&
      JUICE_WEB_TOOLS.has(toolName)
    ) {
      const r = compress(output);
      if (r.savedChars > 0) return r.output;
    }
    return output;
  }

  const repeatedLine = 'GET /cookie-banner-please-accept-tracking-consent HTTP/1.1 200 OK\n';
  // >2000 chars of a repetitive web log surrounded by unique signal.
  const bigWebOutput = 'UNIQUE HEADER LINE\n' + repeatedLine.repeat(80) + 'UNIQUE FOOTER LINE';

  it('compresses a LARGE web_fetch output above the threshold', () => {
    expect(bigWebOutput.length).toBeGreaterThan(JUICE_MIN_CHARS);
    const out = gatedCompress('web_fetch', bigWebOutput);
    expect(out.length).toBeLessThan(bigWebOutput.length);
    expect(out).toContain('(× 80 identique)');
    // No information lost: unique surrounding lines survive.
    expect(out).toContain('UNIQUE HEADER LINE');
    expect(out).toContain('UNIQUE FOOTER LINE');
    // The repeated line still appears (once) so the agent knows what repeated.
    expect(out).toContain('cookie-banner-please-accept-tracking-consent');
  });

  it('leaves a SMALL web_fetch output untouched (below threshold)', () => {
    const small = 'UNIQUE HEADER LINE\n' + repeatedLine.repeat(3) + 'UNIQUE FOOTER LINE';
    expect(small.length).toBeLessThan(JUICE_MIN_CHARS);
    expect(gatedCompress('web_fetch', small)).toBe(small);
  });

  it('does NOT touch a large output from a non-web tool (scope guard)', () => {
    expect(gatedCompress('bash', bigWebOutput)).toBe(bigWebOutput);
    expect(gatedCompress('view_file', bigWebOutput)).toBe(bigWebOutput);
  });
});
