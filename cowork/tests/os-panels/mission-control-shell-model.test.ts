import { describe, expect, it } from 'vitest';
import { describeMissionLayout, summarizeMissionLayout } from '../../src/renderer/components/os-panels/mission-control-shell-model.js';

describe('mission control shell model', () => {
  it('detects active slots in stable order', () => {
    const summary = summarizeMissionLayout({ right: true, main: true, header: true });

    expect(summary.activeSlots).toEqual(['header', 'main', 'right']);
    expect(summary.hasSidebars).toBe(true);
    expect(summary.columnClass).toContain('minmax');
  });

  it('describes empty layouts', () => {
    expect(describeMissionLayout({})).toBe('Cadre vide');
  });
});
