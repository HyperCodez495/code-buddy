import { describe, it, expect } from 'vitest';
import {
  groupByType,
  typeLabel,
  confidencePct,
  shortDate,
  normalizeTopic,
  type KnowledgeEntity,
} from './knowledge-panel-helpers';

function ent(partial: Partial<KnowledgeEntity> & { id: string; type: string; createdAt: string }): KnowledgeEntity {
  return {
    name: partial.name ?? partial.id,
    source: partial.source,
    confidence: partial.confidence ?? 0.5,
    mentions: partial.mentions ?? 1,
    contributors: partial.contributors ?? 1,
    ...partial,
  };
}

describe('knowledge-panel-helpers', () => {
  it('groupByType puts discoveries first, unknown types alphabetical, newest-first within a group', () => {
    const entities = [
      ent({ id: 'z', type: 'zeta', createdAt: '2026-01-01T00:00:00Z' }),
      ent({ id: 'd1', type: 'discovery', createdAt: '2026-06-01T00:00:00Z' }),
      ent({ id: 'd2', type: 'discovery', createdAt: '2026-06-10T00:00:00Z' }),
      ent({ id: 'l', type: 'lesson', createdAt: '2026-05-01T00:00:00Z' }),
      ent({ id: 'a', type: 'alpha', createdAt: '2026-01-01T00:00:00Z' }),
    ];
    const groups = groupByType(entities);
    expect(groups.map((g) => g.type)).toEqual(['discovery', 'lesson', 'alpha', 'zeta']);
    // newest-first inside discovery
    expect(groups[0]!.entities.map((e) => e.id)).toEqual(['d2', 'd1']);
  });

  it('groupByType returns [] for no entities', () => {
    expect(groupByType([])).toEqual([]);
  });

  it('typeLabel maps known types and passes through unknowns', () => {
    expect(typeLabel('discovery')).toMatch(/Découvertes/);
    expect(typeLabel('lesson')).toMatch(/Leçons/);
    expect(typeLabel('weird-thing')).toBe('weird-thing');
  });

  it('confidencePct clamps to 0..100 and rounds', () => {
    expect(confidencePct(0.5)).toBe(50);
    expect(confidencePct(0.837)).toBe(84);
    expect(confidencePct(-1)).toBe(0);
    expect(confidencePct(2)).toBe(100);
    expect(confidencePct(Number.NaN)).toBe(0);
  });

  it('shortDate extracts YYYY-MM-DD or empty', () => {
    expect(shortDate('2026-06-30T12:00:00.000Z')).toBe('2026-06-30');
    expect(shortDate('nope')).toBe('');
    expect(shortDate('')).toBe('');
  });

  it('normalizeTopic trims and rejects empty', () => {
    expect(normalizeTopic('  agentic RAG  ')).toBe('agentic RAG');
    expect(normalizeTopic('   ')).toBeNull();
    expect(normalizeTopic('')).toBeNull();
  });
});
