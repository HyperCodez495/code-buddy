/**
 * Prefetch config + engine tests — pure matching/compute with injected deps and
 * isolated temp stores (no network, no daemon).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addPrefetchItem,
  loadPrefetchItems,
  prefetchItemKey,
  removePrefetchItem,
  savePrefetchItems,
  DEFAULT_PREFETCH_ITEMS,
  type PrefetchItem,
} from '../../src/companion/prefetch-config.js';
import {
  computeAnswer,
  frenchDate,
  intentKeyForQuery,
  matchPrefetched,
  normalizeQuery,
  runPrefetchCycle,
  loadPrefetchCache,
  type PrefetchEntry,
} from '../../src/companion/prefetch-engine.js';

function tmpFile(name: string): string {
  return join(mkdtempSync(join(tmpdir(), 'pf-')), name);
}

describe('prefetch-config', () => {
  it('returns defaults when no file, respects a saved list', () => {
    const path = tmpFile('items.json');
    expect(loadPrefetchItems(path)).toEqual(DEFAULT_PREFETCH_ITEMS);
    savePrefetchItems([{ kind: 'weather', param: 'Paris' }], path);
    expect(loadPrefetchItems(path)).toEqual([{ kind: 'weather', param: 'Paris' }]);
  });

  it('adds (dedup by key), removes, and keys items', () => {
    let items: PrefetchItem[] = [];
    items = addPrefetchItem({ kind: 'weather', param: 'Paris' }, items);
    items = addPrefetchItem({ kind: 'weather', param: 'paris' }, items); // same key → replace
    items = addPrefetchItem({ kind: 'news' }, items);
    expect(items).toHaveLength(2);
    expect(prefetchItemKey({ kind: 'weather', param: 'Paris' })).toBe('weather:paris');
    expect(prefetchItemKey({ kind: 'news' })).toBe('news');
    expect(removePrefetchItem(0, items)).toEqual([{ kind: 'news' }]);
  });

  it('drops invalid kinds', () => {
    const path = tmpFile('bad.json');
    savePrefetchItems([{ kind: 'weather' }, { kind: 'nope' } as unknown as PrefetchItem], path);
    expect(loadPrefetchItems(path)).toEqual([{ kind: 'weather' }]);
  });
});

describe('intentKeyForQuery', () => {
  const items: PrefetchItem[] = [
    { kind: 'weather', param: 'Paris' },
    { kind: 'weather', param: 'Lyon' },
    { kind: 'news' },
    { kind: 'agenda' },
    { kind: 'date' },
  ];

  it('routes weather to the named city, else the first', () => {
    expect(intentKeyForQuery('quelle est la météo à Lyon ?', items)).toBe('weather:lyon');
    expect(intentKeyForQuery('il fait quel temps ?', items)).toBe('weather:paris');
  });

  it('routes news / agenda / date', () => {
    expect(intentKeyForQuery('quelles sont les actualités', items)).toBe('news');
    expect(intentKeyForQuery("qu'est-ce que j'ai aujourd'hui", items)).toBe('agenda');
    expect(intentKeyForQuery('on est quel jour ?', items)).toBe('date');
  });

  it('returns null for weather when no weather item, and for non-matches', () => {
    expect(intentKeyForQuery('quelle est la météo ?', [{ kind: 'date' }])).toBeNull();
    expect(intentKeyForQuery('raconte-moi ta vie', items)).toBeNull();
  });

  it('normalizeQuery strips accents', () => {
    expect(normalizeQuery('Météo À Paris')).toBe('meteo a paris');
  });
});

describe('matchPrefetched', () => {
  const items: PrefetchItem[] = [{ kind: 'weather', param: 'Paris' }, { kind: 'date' }];
  const now = 1_000_000_000_000;
  const cache: PrefetchEntry[] = [
    { key: 'weather:paris', kind: 'weather', answer: 'Il fait 18°C à Paris.', at: now - 60_000 },
    { key: 'date', kind: 'date', answer: 'Nous sommes lundi.', at: now - 60_000 },
  ];

  it('returns a fresh cached answer', () => {
    expect(matchPrefetched('la météo à Paris', { cache, items, now })).toBe(
      'Il fait 18°C à Paris.'
    );
  });

  it('returns null when the entry is stale (past its TTL)', () => {
    const stale = [{ ...cache[0]!, at: now - 60 * 60_000 }]; // 1h > weather 45min TTL
    expect(matchPrefetched('la météo à Paris', { cache: stale, items, now })).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(matchPrefetched('bonjour', { cache, items, now })).toBeNull();
  });
});

describe('computeAnswer + runPrefetchCycle (injected deps)', () => {
  const now = 1_700_000_000_000;

  it('computes each kind via injected fetchers', async () => {
    const deps = {
      now,
      fetchWeather: async (c: string) => `Météo ${c}: beau.`,
      fetchNews: async () => 'Voici les gros titres : A ; B.',
      fetchAgenda: async () => 'Rien de prévu.',
    };
    expect((await computeAnswer({ kind: 'weather', param: 'Nice' }, deps))?.answer).toBe(
      'Météo Nice: beau.'
    );
    expect((await computeAnswer({ kind: 'news' }, deps))?.answer).toContain('gros titres');
    expect((await computeAnswer({ kind: 'agenda' }, deps))?.answer).toBe('Rien de prévu.');
    expect((await computeAnswer({ kind: 'date' }, { now }))?.answer).toBe(frenchDate(now));
  });

  it('returns null when a fetcher yields nothing (fail-open)', async () => {
    expect(
      await computeAnswer({ kind: 'weather', param: 'X' }, { fetchWeather: async () => null })
    ).toBeNull();
  });

  it('runs a cycle, writing computed answers to the cache', async () => {
    const itemsPath = tmpFile('items.json');
    const cachePath = tmpFile('cache.json');
    savePrefetchItems([{ kind: 'date' }, { kind: 'weather', param: 'Paris' }], itemsPath);
    const res = await runPrefetchCycle({
      now,
      itemsPath,
      cachePath,
      fetchWeather: async () => 'Il fait 20°C.',
    });
    expect(res.computed.sort()).toEqual(['date', 'weather:paris']);
    const cache = loadPrefetchCache(cachePath);
    expect(cache.find((e) => e.key === 'weather:paris')?.answer).toBe('Il fait 20°C.');
  });
});
