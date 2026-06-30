import { describe, it, expect } from 'vitest';
import { matchCodeExplorerPrefix } from '../../src/codebuddy/tools.js';

describe('Code Explorer tool detection (naming schism fix)', () => {
  it('recognizes the user-config server name `code-explorer`', () => {
    expect(matchCodeExplorerPrefix(['view_file', 'mcp__code-explorer__impact'])).toBe('mcp__code-explorer__');
  });

  it('ALSO recognizes the committed repo server name `gitnexus` (previously un-steered)', () => {
    expect(matchCodeExplorerPrefix(['mcp__gitnexus__query', 'bash'])).toBe('mcp__gitnexus__');
  });

  it('returns null when no Code Explorer tool is present', () => {
    expect(matchCodeExplorerPrefix(['view_file', 'mcp__brave-search__brave_web_search'])).toBeNull();
    expect(matchCodeExplorerPrefix([])).toBeNull();
  });
});
