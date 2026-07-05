import { describe, expect, it } from 'vitest';
import { normalizeStatusItem, sortStatusItems, summarizeStatus } from '../../src/renderer/components/os-panels/os-status-bar-model.js';

describe('os status bar model', () => {
  it('normalizes empty values and default tone', () => {
    expect(normalizeStatusItem({ label: '  ', value: '  ' })).toEqual({ label: 'Statut', value: '—', tone: 'muted', rank: 3 });
  });

  it('sorts urgent statuses first and counts tones', () => {
    const items = sortStatusItems([
      { label: 'Fleet', value: 'ok', tone: 'ok' },
      { label: 'Budget', value: 'haut', tone: 'warn' },
      { label: 'Auth', value: 'down', tone: 'error' },
    ]);

    expect(items.map((item) => item.tone)).toEqual(['error', 'warn', 'ok']);
    expect(summarizeStatus(items)).toEqual({ ok: 1, warn: 1, error: 1, muted: 0 });
  });
});
