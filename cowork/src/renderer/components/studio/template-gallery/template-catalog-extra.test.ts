import { describe, expect, it } from 'vitest';
import { EXTRA_TEMPLATES } from './template-catalog-extra.js';
import type { TemplateCard } from './template-catalog-extra.js';

function acceptsTemplateCards(_templates: TemplateCard[]): void {
  // Compile-time type assertion helper.
}

describe('EXTRA_TEMPLATES', () => {
  it('contains 8 templates', () => {
    expect(EXTRA_TEMPLATES).toHaveLength(8);
  });

  it('uses unique extra-prefixed ids', () => {
    const ids = EXTRA_TEMPLATES.map((template) => template.id);

    expect(ids.every((id) => id.startsWith('extra-'))).toBe(true);
    expect(new Set(ids).size).toBe(EXTRA_TEMPLATES.length);
  });

  it('has non-empty name, tagline and prompt fields', () => {
    for (const template of EXTRA_TEMPLATES) {
      expect(template.name.trim()).not.toBe('');
      expect(template.tagline.trim()).not.toBe('');
      expect(template.prompt.trim()).not.toBe('');
    }
  });

  it('conforms to the TemplateCard type', () => {
    acceptsTemplateCards(EXTRA_TEMPLATES);
    expect(EXTRA_TEMPLATES.every((template) => template.mockupSvg.trim().startsWith('<svg'))).toBe(true);
  });
});
