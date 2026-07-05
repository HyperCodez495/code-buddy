/**
 * OS panels pure models — real tests (no mocks): autonomy formatting, knowledge
 * graph helpers, status bar aggregation.
 */
import { describe, expect, it } from 'vitest';
import {
  clampPercent,
  formatUsd,
  toneForPercent,
} from '../../src/renderer/components/os-panels/autonomy-dashboard-model';
import {
  normalizeConfidence,
  countEdgesForNode,
} from '../../src/renderer/components/os-panels/knowledge-graph-view-model';
import {
  sortStatusItems,
  summarizeStatus,
} from '../../src/renderer/components/os-panels/os-status-bar-model';

describe('autonomy-dashboard-model', () => {
  it('clampPercent maps value/max into 0..100 and guards bad input', () => {
    expect(clampPercent(5, 10)).toBe(50);
    expect(clampPercent(20, 10)).toBe(100);
    expect(clampPercent(-1, 10)).toBe(0);
    expect(clampPercent(1, 0)).toBe(0);
    expect(clampPercent(Number.NaN, 10)).toBe(0);
  });

  it('formatUsd renders currency and guards non-finite', () => {
    expect(formatUsd(3.5)).toBe('$3.50');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(Number.NaN)).toBe('$0.00');
  });

  it('toneForPercent escalates at 70 and 90', () => {
    expect(toneForPercent(10)).toBe('success');
    expect(toneForPercent(75)).toBe('warning');
    expect(toneForPercent(95)).toBe('danger');
  });
});

describe('knowledge-graph-view-model', () => {
  it('normalizeConfidence clamps to [0,1] and nulls invalid', () => {
    expect(normalizeConfidence(0.5)).toBe(0.5);
    expect(normalizeConfidence(2)).toBe(1);
    expect(normalizeConfidence(-1)).toBe(0);
    expect(normalizeConfidence(undefined)).toBeNull();
  });

  it('countEdgesForNode counts both directions', () => {
    const edges = [
      { from: 'a', to: 'b', kind: 'related_to' },
      { from: 'c', to: 'a', kind: 'supports' },
      { from: 'b', to: 'c', kind: 'related_to' },
    ];
    expect(countEdgesForNode('a', edges)).toBe(2);
    expect(countEdgesForNode('z', edges)).toBe(0);
  });
});

describe('os-status-bar-model', () => {
  it('summarizeStatus counts by tone and sortStatusItems is stable', () => {
    const items = [
      { label: 'CPU', value: 'ok', tone: 'ok' as const },
      { label: 'Réseau', value: 'lent', tone: 'warn' as const },
      { label: 'Disque', value: 'plein', tone: 'error' as const },
      { label: 'MCP', value: '—', tone: 'muted' as const },
    ];
    const summary = summarizeStatus(items);
    expect(summary).toEqual({ ok: 1, warn: 1, error: 1, muted: 1 });
    expect(sortStatusItems(items)).toHaveLength(4);
  });
});
