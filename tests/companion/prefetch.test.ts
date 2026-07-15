/**
 * Prefetch config + engine tests — pure matching/compute with injected deps and
 * isolated temp stores (no network, no daemon).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addPrefetchItem,
  DEFAULT_MARKET_SYMBOLS,
  DEFAULT_NEWS_QUERY,
  DEFAULT_PREFETCH_ITEMS,
  loadPrefetchItems,
  loadMarketSymbols,
  prefetchItemKey,
  removePrefetchItem,
  savePrefetchItems,
  type PrefetchItem,
} from '../../src/companion/prefetch-config.js';
import {
  buildNewsSearchQueries,
  computeAnswer,
  fetchMarketContext,
  frenchDate,
  intentKeyForQuery,
  matchPrefetched,
  matchPrefetchedDetailed,
  normalizeQuery,
  parseNewsRss,
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

  it('keeps the three default indices and bounds a deduplicated configured watchlist', () => {
    const configured = loadMarketSymbols({
      CODEBUDDY_MARKET_SYMBOLS:
        'aapl, MC.PA, aapl, invalid symbol, BTC-USD, one,two,three,four,five,six,seven,eight',
    });
    expect(configured.slice(0, 3)).toEqual([...DEFAULT_MARKET_SYMBOLS]);
    expect(configured).toContain('AAPL');
    expect(configured).toContain('MC.PA');
    expect(configured.filter((symbol) => symbol === 'AAPL')).toHaveLength(1);
    expect(configured).not.toContain('INVALID SYMBOL');
    expect(configured).toHaveLength(10);
  });
});

describe('news RSS evidence', () => {
  it('decodes RSS entities and retains concrete source metadata', () => {
    const xml = `<?xml version="1.0"?><rss><channel><item>
      <title>Incendies de Fontainebleau&#xA0;: les feux sont &quot;fixés&quot;</title>
      <description><![CDATA[Le préfet confirme que les secours restent mobilisés.]]></description>
      <pubDate>Tue, 14 Jul 2026 20:03:35 +0200</pubDate>
      <link>https://www.franceinfo.fr/france/incendies/article.html</link>
    </item></channel></rss>`;

    expect(parseNewsRss(xml, 'franceinfo')).toEqual([{
      title: 'Incendies de Fontainebleau : les feux sont "fixés"',
      summary: 'Le préfet confirme que les secours restent mobilisés.',
      publishedAt: 'Tue, 14 Jul 2026 20:03:35 +0200',
      url: 'https://www.franceinfo.fr/france/incendies/article.html',
      source: 'franceinfo',
    }]);
  });
});

describe('intentKeyForQuery', () => {
  const items: PrefetchItem[] = [
    { kind: 'weather', param: 'Paris' },
    { kind: 'weather', param: 'Lyon' },
    { kind: 'news' },
    { kind: 'market' },
    { kind: 'agenda' },
    { kind: 'date' },
  ];

  it('routes weather to the named city, else the first', () => {
    expect(intentKeyForQuery('quelle est la météo à Lyon ?', items)).toBe('weather:lyon');
    expect(intentKeyForQuery('il fait quel temps ?', items)).toBe('weather:paris');
  });

  it('routes market / news / agenda / date', () => {
    expect(intentKeyForQuery('où en est la bourse ?', items)).toBe('market');
    expect(intentKeyForQuery('donne-moi le CAC 40 et le S&P 500', items)).toBe('market');
    expect(intentKeyForQuery('comment évolue mon portefeuille boursier ?', items)).toBe('market');
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

describe('news search lanes', () => {
  it('balances the default bulletin across general and technology news with an exact date', () => {
    const queries = buildNewsSearchQueries(
      DEFAULT_NEWS_QUERY,
      Date.parse('2026-07-13T12:00:00.000Z'),
      'fr-FR',
      { TZ: 'Europe/Paris' }
    );
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain('France monde');
    expect(queries[1]).toContain('intelligence artificielle');
    expect(queries.every((query) => query.includes('13 juillet 2026'))).toBe(true);
  });

  it('keeps a custom topic in a single dated lane', () => {
    expect(
      buildNewsSearchQueries('actualité spatiale', Date.parse('2026-07-13T12:00:00Z'), 'fr-FR')
    ).toEqual(['actualité spatiale 13 juillet 2026']);
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

  it('serves bounded stale news with an explicit freshness disclosure', () => {
    const newsItems: PrefetchItem[] = [{ kind: 'news' }];
    const newsCache: PrefetchEntry[] = [
      {
        key: 'news',
        kind: 'news',
        answer: 'Ancien bulletin.',
        at: now - 30 * 60_000,
        context: {
          kind: 'news',
          query: 'actualité',
          locale: 'fr-FR',
          fetchedAt: now - 30 * 60_000,
          items: [{ title: 'Titre vérifié', url: 'https://example.com', source: 'Exemple' }],
        },
      },
    ];
    const match = matchPrefetchedDetailed('les actualités', {
      cache: newsCache,
      items: newsItems,
      now,
      allowStale: true,
    });
    expect(match?.freshness).toBe('stale');
    expect(match?.answer).toContain('30 minutes');
    expect(match?.answer).toContain('Titre vérifié');
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

  it('stores structured news evidence rather than only canned prose', async () => {
    const entry = await computeAnswer(
      { kind: 'news' },
      {
        now,
        fetchNewsContext: async () => ({
          kind: 'news',
          query: 'actualité',
          locale: 'fr-FR',
          fetchedAt: now,
          items: [{ title: 'Titre', url: 'https://example.com', source: 'Exemple' }],
        }),
      }
    );
    expect(entry?.context?.kind).toBe('news');
    expect(entry?.answer).toContain('selon Exemple');
  });

  it('stores a structured, source-attributed market digest', async () => {
    const entry = await computeAnswer(
      { kind: 'market' },
      {
        now,
        marketSymbols: ['^FCHI'],
        fetchMarketContext: async (symbols, fetchedAt) => ({
          kind: 'market',
          locale: 'fr-FR',
          fetchedAt,
          symbols: [...symbols],
          items: [{
            title: 'CAC 40 (^FCHI)',
            url: 'https://quotes.example.test/cac40',
            source: 'Yahoo Finance',
            symbol: '^FCHI',
            name: 'CAC 40',
            type: 'market',
            price: 7654.2,
            changePercent: -0.56,
            fetchedAt,
            quoteTime: '17:35',
          }],
        }),
      }
    );
    expect(entry?.context?.kind).toBe('market');
    expect(entry?.answer).toContain('CAC 40');
    expect(entry?.answer).toContain('cotation 17:35');
    expect(entry?.answer).toContain('selon Yahoo Finance');
  });
});

describe('fetchMarketContext', () => {
  it('starts quotes in parallel and preserves partial successes with provenance', async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = fetchMarketContext(
      ['^FCHI', '^GSPC', '^IXIC'],
      1_700_000_000_000,
      async (symbol) => {
        started.push(symbol);
        await gate;
        if (symbol === '^GSPC') throw new Error('provider unavailable');
        if (symbol === '^IXIC') return { success: false, error: 'not found' };
        return {
          success: true,
          output: 'CAC 40.',
          data: {
            type: 'market',
            symbol,
            name: 'CAC 40',
            price: 7654.2,
            changePercent: 0.42,
            time: '17:35',
          },
          metadata: {
            provider: 'Yahoo Finance',
            sourceUrl: 'https://quotes.example.test/cac40',
            fetchedAt: 1_700_000_000_100,
            quoteTime: '17:35',
          },
        };
      }
    );

    await Promise.resolve();
    expect(started).toEqual(['^FCHI', '^GSPC', '^IXIC']);
    release();
    const digest = await pending;
    expect(digest?.items).toHaveLength(1);
    expect(digest?.items[0]).toMatchObject({
      symbol: '^FCHI',
      source: 'Yahoo Finance',
      quoteTime: '17:35',
      fetchedAt: 1_700_000_000_100,
    });
  });
});
