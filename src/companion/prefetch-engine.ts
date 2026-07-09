/**
 * Prefetch engine — precompute answers to common voice questions so they can be
 * served INSTANTLY (no LLM). A heartbeat treatment calls `runPrefetchCycle`
 * periodically; the reply path (hybrid-reply.ts) calls `matchPrefetched` and, on
 * a hit, returns the cached answer text directly (only the TTS synth remains).
 *
 * Reuses the real tools: WeatherTool (Open-Meteo, $0), WebSearchTool (headlines),
 * reminders agenda, and an inline French date. All deps are injectable so the
 * engine is unit-testable without network. never-throws.
 *
 * @module companion/prefetch-engine
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { logger } from '../utils/logger.js';
import {
  loadPrefetchItems,
  prefetchItemKey,
  type PrefetchItem,
  type PrefetchKind,
} from './prefetch-config.js';

export interface PrefetchEntry {
  key: string;
  kind: PrefetchKind;
  answer: string;
  at: number;
}

/** Max age (ms) a cached answer stays servable, per kind. The heartbeat refreshes
 *  far more often; this is just a staleness backstop. */
const TTL_MS: Record<PrefetchKind, number> = {
  weather: 45 * 60_000,
  news: 4 * 60 * 60_000,
  agenda: 6 * 60 * 60_000,
  date: 12 * 60 * 60_000,
};

export interface PrefetchDeps {
  now?: number;
  cachePath?: string;
  itemsPath?: string;
  /** city → spoken weather text (null on failure). Default: WeatherTool. */
  fetchWeather?: (city: string) => Promise<string | null>;
  /** query → spoken headlines text. Default: WebSearchTool. */
  fetchNews?: (query: string) => Promise<string | null>;
  /** now → spoken agenda text. Default: reminders. */
  fetchAgenda?: (now: number) => Promise<string | null>;
  /** now → spoken French date. Default: inline. */
  makeDate?: (now: number) => string;
}

// ---------------------------------------------------------------------------
// Cache store (JSON under ~/.codebuddy/companion/)
// ---------------------------------------------------------------------------

export function defaultPrefetchCachePath(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.CODEBUDDY_PREFETCH_CACHE_FILE?.trim() ||
    join(homedir(), '.codebuddy', 'companion', 'prefetch-cache.json')
  );
}

export function loadPrefetchCache(path: string = defaultPrefetchCachePath()): PrefetchEntry[] {
  try {
    if (!existsSync(path)) return [];
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return Array.isArray(raw) ? (raw as PrefetchEntry[]).filter((e) => e && e.key && e.answer) : [];
  } catch {
    return [];
  }
}

export function savePrefetchCache(
  entries: PrefetchEntry[],
  path: string = defaultPrefetchCachePath()
): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(entries, null, 2));
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Intent matching (pure)
// ---------------------------------------------------------------------------

/** Lowercase + strip diacritics so STT accents don't break matching. Pure. */
export function normalizeQuery(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '') // strip combining diacritics (accents)
    .replace(/['’`\-_.,!?;:()]/g, ' ') // apostrophes/hyphens/punctuation → space (STT-robust)
    .replace(/\s+/g, ' ')
    .trim();
}

const KIND_PATTERNS: Record<PrefetchKind, RegExp> = {
  weather: /\b(meteo|quel temps|le temps qu|temps qu il fait|il fait quel temps)\b/,
  news: /\b(actualite|actualites|nouvelles|les infos|quoi de neuf|gros titres|l actu)\b/,
  agenda:
    /\b(agenda|mes rappels|mon programme|au programme|qu est ce que j ai|mes rendez|ma journee)\b/,
  date: /\b(quel jour|quelle date|on est quel|le jour on est|date du jour|quel jour on est|on est le combien)\b/,
};

/**
 * Which prefetch cache key a question wants, given the configured items (needed
 * to resolve the weather city). Returns null when nothing matches. Pure.
 */
export function intentKeyForQuery(heard: string, items: PrefetchItem[]): string | null {
  const q = normalizeQuery(heard);
  if (!q) return null;

  if (KIND_PATTERNS.weather.test(q)) {
    const weatherItems = items.filter((i) => i.kind === 'weather');
    if (weatherItems.length === 0) return null;
    // Prefer a configured city whose name is spoken in the question.
    const named = weatherItems.find((i) => i.param && q.includes(normalizeQuery(i.param)));
    return prefetchItemKey(named ?? weatherItems[0]!);
  }
  for (const kind of ['news', 'agenda', 'date'] as const) {
    if (KIND_PATTERNS[kind].test(q)) return kind;
  }
  return null;
}

/**
 * Return a fresh cached answer for `heard`, or null. Pure over the injected
 * cache + items (the reply path passes the loaded cache).
 */
export function matchPrefetched(
  heard: string,
  args: { cache: PrefetchEntry[]; items: PrefetchItem[]; now: number }
): string | null {
  const key = intentKeyForQuery(heard, args.items);
  if (!key) return null;
  const entry = args.cache.find((e) => e.key === key);
  if (!entry) return null;
  const ttl = TTL_MS[entry.kind] ?? 60 * 60_000;
  return args.now - entry.at < ttl ? entry.answer : null;
}

// ---------------------------------------------------------------------------
// Default compute impls (real tools, lazy-imported)
// ---------------------------------------------------------------------------

const FR_WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const FR_MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

export function frenchDate(now: number): string {
  const d = new Date(now);
  return `Nous sommes le ${FR_WEEKDAYS[d.getDay()]} ${d.getDate()} ${FR_MONTHS[d.getMonth()]} ${d.getFullYear()}.`;
}

async function defaultFetchWeather(city: string): Promise<string | null> {
  try {
    const { WeatherTool } = await import('../tools/weather.js');
    const res = await new WeatherTool().getWeather(city || 'Paris', 1);
    return res.success && res.output ? res.output.trim() : null;
  } catch {
    return null;
  }
}

async function defaultFetchNews(query: string): Promise<string | null> {
  try {
    const { WebSearchTool } = await import('../tools/web-search.js');
    const rows = await new WebSearchTool().searchStructured(
      query || "actualités France aujourd'hui gros titres",
      {
        maxResults: 5,
        search_lang: 'fr',
        freshness: 'pd',
        mode: 'live',
      }
    );
    const titles = (rows ?? [])
      .map((r) => (r?.title ?? '').trim())
      .filter(Boolean)
      .slice(0, 5);
    if (titles.length === 0) return null;
    return `Voici les gros titres du jour : ${titles.join(' ; ')}.`;
  } catch {
    return null;
  }
}

async function defaultFetchAgenda(now: number): Promise<string | null> {
  try {
    const { loadReminders, agendaFor, describeAgendaForSpeech } = await import('./reminders.js');
    const reminders = await loadReminders();
    return describeAgendaForSpeech(agendaFor(reminders, now, 2), now);
  } catch {
    return null;
  }
}

/** Compute the spoken answer for one item. Returns the cache entry, or null on failure. */
export async function computeAnswer(
  item: PrefetchItem,
  deps: PrefetchDeps = {}
): Promise<PrefetchEntry | null> {
  const now = deps.now ?? Date.now();
  const key = prefetchItemKey(item);
  let answer: string | null = null;
  try {
    switch (item.kind) {
      case 'weather':
        answer = await (deps.fetchWeather ?? defaultFetchWeather)((item.param ?? '').trim());
        break;
      case 'news':
        answer = await (deps.fetchNews ?? defaultFetchNews)((item.param ?? '').trim());
        break;
      case 'agenda':
        answer = await (deps.fetchAgenda ?? defaultFetchAgenda)(now);
        break;
      case 'date':
        answer = (deps.makeDate ?? frenchDate)(now);
        break;
    }
  } catch {
    answer = null;
  }
  const clean = (answer ?? '').trim();
  return clean ? { key, kind: item.kind, answer: clean, at: now } : null;
}

export interface PrefetchCycleResult {
  computed: string[];
  failed: string[];
}

/**
 * One prefetch cycle: recompute every configured item and merge into the cache
 * (updating computed keys, preserving others). never-throws.
 */
export async function runPrefetchCycle(deps: PrefetchDeps = {}): Promise<PrefetchCycleResult> {
  const items = loadPrefetchItems(deps.itemsPath);
  const cachePath = deps.cachePath;
  const cache = loadPrefetchCache(cachePath);
  const byKey = new Map(cache.map((e) => [e.key, e]));
  const result: PrefetchCycleResult = { computed: [], failed: [] };

  for (const item of items) {
    const entry = await computeAnswer(item, deps);
    if (entry) {
      byKey.set(entry.key, entry);
      result.computed.push(entry.key);
    } else {
      result.failed.push(prefetchItemKey(item));
    }
  }

  savePrefetchCache([...byKey.values()], cachePath);
  logger.info(
    `[prefetch] cycle: ${result.computed.length} prêt(s) [${result.computed.join(', ')}]` +
      (result.failed.length ? `, ${result.failed.length} échec(s)` : '')
  );
  return result;
}
