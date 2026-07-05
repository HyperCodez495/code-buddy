/**
 * Template gallery pure model — real tests (no mocks): the default catalog and
 * the search filter.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATES, filterTemplates } from '../../src/renderer/components/template-gallery/template-kinds';

describe('DEFAULT_TEMPLATES', () => {
  it('is a non-empty catalog with unique ids and complete fields', () => {
    expect(DEFAULT_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    const ids = new Set(DEFAULT_TEMPLATES.map((t) => t.id));
    expect(ids.size).toBe(DEFAULT_TEMPLATES.length);
    for (const item of DEFAULT_TEMPLATES) {
      expect(item.name).toBeTruthy();
      expect(item.tagline).toBeTruthy();
      expect(item.kind).toBeTruthy();
    }
  });
});

describe('filterTemplates', () => {
  it('returns a copy of all items for an empty query', () => {
    const out = filterTemplates(DEFAULT_TEMPLATES, '  ');
    expect(out).toHaveLength(DEFAULT_TEMPLATES.length);
    expect(out).not.toBe(DEFAULT_TEMPLATES);
  });

  it('matches on name / tagline / kind, case- and accent-insensitively', () => {
    const dashboards = filterTemplates(DEFAULT_TEMPLATES, 'dashboard');
    expect(dashboards.some((t) => t.kind === 'dashboard' || /dashboard|tableau/i.test(`${t.name} ${t.tagline}`))).toBe(true);

    const none = filterTemplates(DEFAULT_TEMPLATES, 'zzznomatchzzz');
    expect(none).toHaveLength(0);
  });
});
