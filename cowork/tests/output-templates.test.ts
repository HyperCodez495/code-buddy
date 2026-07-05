import { describe, expect, it } from 'vitest';

import { OUTPUT_TEMPLATES, templateById } from '../src/renderer/utils/output-templates';

describe('OUTPUT_TEMPLATES', () => {
  it('contains the expected output families', () => {
    expect(OUTPUT_TEMPLATES.map((template) => template.id)).toEqual(['report', 'deck', 'table', 'page', 'podcast']);
  });
});

describe('templateById', () => {
  it('returns a template by id', () => {
    expect(templateById('deck')?.mappedTool).toBe('pptx_skill');
  });

  it('returns undefined for unknown ids', () => {
    expect(templateById('unknown')).toBeUndefined();
  });
});
