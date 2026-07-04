/**
 * Deep Research — Phase A (GPT-Researcher-style deterministic, cited pipeline).
 *
 * This is the OPT-IN counterpart to Wide Research (`wide-research.ts`). Wide
 * Research fans out coarse *thematic* subtopics and lets each worker agent
 * decide (non-deterministically) whether to search/scrape; citations are lost
 * at aggregation. Deep Research replaces that with a deterministic, bounded,
 * end-to-end-cited pipeline:
 *
 *   1. plan     — question → N sub-questions → 2-3 concrete search queries each
 *                 (one bounded LLM call, deterministic fallback on any failure)
 *   2. collect  — DETERMINISTIC fan-out: each query → web_search(top-K) →
 *                 unique URLs → scrape in parallel batches (Firecrawl or cheap
 *                 fetch), globally bounded. A failed scrape drops that source.
 *   3. dedup    — pragmatic near-duplicate detection between scraped sources
 *                 (normalize → word-shingle hashes → Jaccard), like the dHash
 *                 dedup in tools/video/frame-dedup.ts. No new heavy dep.
 *   4. cite     — a source registry {id,url,title} is threaded from collection
 *                 to synthesis; the report carries inline [n] markers and a
 *                 numbered "## Références" section rendered deterministically.
 *   5. synthesize — one LLM call aggregates the deduped, cited sources into a
 *                 structured report (TL;DR, body per sub-question, references),
 *                 with a deterministic fallback body on failure.
 *
 * Everything here is PURE and its side-effecting edges (LLM, search, scrape,
 * fingerprint, batching) are INJECTABLE `DeepResearchBoundaries` so the whole
 * pipeline is unit-testable with zero network. Every stage is never-throws:
 * a boundary failure degrades gracefully, it never crashes the research.
 *
 * @module agent/deep-research
 */

import { logger } from '../utils/logger.js';

// ============================================================================
// Options (all BOUNDED — token/time cost is capped regardless of the question)
// ============================================================================

export interface DeepResearchOptions {
  /** Max sub-questions the planner may emit (default 4). */
  maxSubQuestions?: number;
  /** Concrete search queries per sub-question (default 3, GPT-Researcher-style). */
  queriesPerSubQuestion?: number;
  /** Top-K search results taken per query (default 5). */
  resultsPerQuery?: number;
  /** Global cap on scraped sources across all queries (default 12). */
  maxSources?: number;
  /** Jaccard similarity ≥ threshold ⇒ near-duplicate source, dropped (default 0.8). */
  dedupThreshold?: number;
  /** Parallel scrape batch size (default 5). */
  concurrency?: number;
  /** Per-source content chars fed to synthesis (default 3000). */
  perSourceChars?: number;
}

type ResolvedOptions = Required<DeepResearchOptions>;

const DEFAULTS: ResolvedOptions = {
  maxSubQuestions: 4,
  queriesPerSubQuestion: 3,
  resultsPerQuery: 5,
  maxSources: 12,
  dedupThreshold: 0.8,
  concurrency: 5,
  perSourceChars: 3000,
};

export function resolveDeepResearchOptions(o: DeepResearchOptions = {}): ResolvedOptions {
  return {
    maxSubQuestions: clampInt(o.maxSubQuestions, DEFAULTS.maxSubQuestions, 1, 12),
    queriesPerSubQuestion: clampInt(o.queriesPerSubQuestion, DEFAULTS.queriesPerSubQuestion, 1, 6),
    resultsPerQuery: clampInt(o.resultsPerQuery, DEFAULTS.resultsPerQuery, 1, 10),
    maxSources: clampInt(o.maxSources, DEFAULTS.maxSources, 1, 40),
    dedupThreshold: clampFloat(o.dedupThreshold, DEFAULTS.dedupThreshold, 0.5, 1),
    concurrency: clampInt(o.concurrency, DEFAULTS.concurrency, 1, 10),
    perSourceChars: clampInt(o.perSourceChars, DEFAULTS.perSourceChars, 500, 20000),
  };
}

function clampInt(v: number | undefined, def: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(min, Math.min(max, n));
}
function clampFloat(v: number | undefined, def: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : def;
  return Math.max(min, Math.min(max, n));
}

// ============================================================================
// Data types
// ============================================================================

export interface DeepLlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** A sub-question plus the concrete search queries that answer it. */
export interface SubQuestionPlan {
  subQuestion: string;
  queries: string[];
}

export interface DeepQueryPlan {
  question: string;
  subQuestions: SubQuestionPlan[];
}

/** A scraped source with its stable citation id (assigned AFTER dedup). */
export interface CollectedSource {
  id: number;
  url: string;
  title: string;
  content: string;
  /** The query that surfaced this source (provenance). */
  query: string;
}

/** The citation registry entry threaded end-to-end. */
export interface SourceRef {
  id: number;
  url: string;
  title: string;
}

export interface DeepResearchResult {
  question: string;
  plan: DeepQueryPlan;
  /** Final numbered source registry (post-dedup). */
  sources: SourceRef[];
  /** The cited report (inline [n] markers + "## Références" section). */
  report: string;
  durationMs: number;
  /** True when the LLM planner succeeded (false ⇒ deterministic fallback). */
  plannerLlmUsed: boolean;
  /** True when the LLM synthesizer succeeded (false ⇒ deterministic fallback). */
  synthesisLlmUsed: boolean;
  /** How many scraped sources were dropped as near-duplicates. */
  duplicatesDropped: number;
}

// ============================================================================
// Boundaries (INJECTABLE edges — real impls wired by the orchestrator)
// ============================================================================

export interface DeepResearchBoundaries {
  /** Bounded LLM chat. Returns assistant text; MAY throw (caller falls back). */
  llm(messages: DeepLlmMessage[]): Promise<string>;
  /** Web search returning up to `k` structured hits. Never expected to throw, but caller guards anyway. */
  search(query: string, k: number): Promise<SearchHit[]>;
  /** Scrape a URL → plain/markdown content ('' when empty/unavailable). Caller guards throws. */
  scrape(url: string): Promise<string>;
  /** Content fingerprint for dedup (default: word-shingle hashes). */
  fingerprint?(text: string): number[];
  /** Parallel batched map (default: internal chunk + Promise.all). Injected by the orchestrator to reuse its batching. */
  mapBatched?<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]>;
}

export type DeepResearchStage =
  | { stage: 'planning' }
  | { stage: 'planned'; subQuestions: number; queries: number; llmUsed: boolean }
  | { stage: 'collecting'; urls: number }
  | { stage: 'collected'; scraped: number }
  | { stage: 'deduped'; kept: number; dropped: number }
  | { stage: 'synthesizing' }
  | { stage: 'done'; sources: number };

// ============================================================================
// 1. Query planner
// ============================================================================

const PLANNER_SYSTEM = [
  'You are a research query planner. Given a question, break it into a small set of',
  'independent sub-questions, and for each sub-question write concrete, effective WEB SEARCH',
  'QUERIES (not topics — real queries you would type into a search engine).',
  'Return ONLY a JSON object of the exact shape:',
  '{"subQuestions":[{"subQuestion":"...","queries":["query 1","query 2"]}]}',
  'No prose, no markdown fences.',
].join('\n');

/**
 * Plan concrete search queries. One bounded LLM call; on ANY failure (throw,
 * empty, unparseable) falls back to a deterministic plan. Never throws.
 */
export async function planQueries(
  question: string,
  boundaries: DeepResearchBoundaries,
  opts: ResolvedOptions,
): Promise<{ plan: DeepQueryPlan; llmUsed: boolean }> {
  const userPrompt = [
    `Question: ${question}`,
    '',
    `Produce at most ${opts.maxSubQuestions} sub-questions.`,
    `Each sub-question must have ${opts.queriesPerSubQuestion} concrete search queries.`,
    'Return the JSON object only.',
  ].join('\n');

  try {
    const raw = await boundaries.llm([
      { role: 'system', content: PLANNER_SYSTEM },
      { role: 'user', content: userPrompt },
    ]);
    const parsed = parsePlan(raw, question, opts);
    if (parsed && parsed.subQuestions.length > 0) {
      return { plan: parsed, llmUsed: true };
    }
  } catch (err) {
    logger.debug(`[deep-research] planner LLM failed: ${errMsg(err)}`);
  }
  return { plan: fallbackPlan(question, opts), llmUsed: false };
}

function parsePlan(raw: string, question: string, opts: ResolvedOptions): DeepQueryPlan | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  const rawList = Array.isArray(obj)
    ? (obj as unknown[])
    : Array.isArray((obj as { subQuestions?: unknown })?.subQuestions)
      ? ((obj as { subQuestions: unknown[] }).subQuestions)
      : [];
  const subQuestions: SubQuestionPlan[] = [];
  for (const entry of rawList) {
    if (subQuestions.length >= opts.maxSubQuestions) break;
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { subQuestion?: unknown; queries?: unknown };
    const sq = typeof e.subQuestion === 'string' ? e.subQuestion.trim() : '';
    const queries = Array.isArray(e.queries)
      ? e.queries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).map((q) => q.trim())
      : [];
    if (!sq || queries.length === 0) continue;
    subQuestions.push({ subQuestion: sq, queries: dedupStrings(queries).slice(0, opts.queriesPerSubQuestion) });
  }
  if (subQuestions.length === 0) return null;
  return { question, subQuestions };
}

/**
 * Deterministic fallback plan: the question itself as the single sub-question,
 * with a bounded set of query variants. Fully offline.
 */
export function fallbackPlan(question: string, opts: ResolvedOptions): DeepQueryPlan {
  const base = question.trim();
  const variants = [
    base,
    `${base} overview`,
    `${base} latest developments`,
    `${base} key facts`,
    `${base} pros and cons`,
    `${base} explained`,
  ];
  const queries = dedupStrings(variants).slice(0, opts.queriesPerSubQuestion);
  return { question, subQuestions: [{ subQuestion: base, queries }] };
}

// ============================================================================
// 2. Deterministic source collection (fan-out → top-K → scrape)
// ============================================================================

/**
 * Deterministic fan-out. For every planned query: web_search(top-K) → collect
 * unique URLs in a stable order → globally cap at maxSources → scrape in
 * parallel batches. A search that fails yields no hits for that query; a scrape
 * that fails/returns empty drops that source. Never throws.
 *
 * Returns sources WITHOUT final ids (ids are assigned after dedup).
 */
export async function collectSources(
  plan: DeepQueryPlan,
  boundaries: DeepResearchBoundaries,
  opts: ResolvedOptions,
): Promise<Array<Omit<CollectedSource, 'id'>>> {
  const flatQueries: string[] = [];
  for (const sq of plan.subQuestions) {
    for (const q of sq.queries) flatQueries.push(q);
  }
  const queries = dedupStrings(flatQueries);

  // Run searches in parallel but reassemble hits in deterministic query order.
  const perQueryHits = await Promise.all(
    queries.map(async (query) => {
      try {
        const hits = await boundaries.search(query, opts.resultsPerQuery);
        return { query, hits: Array.isArray(hits) ? hits.slice(0, opts.resultsPerQuery) : [] };
      } catch (err) {
        logger.debug(`[deep-research] search failed for "${query}": ${errMsg(err)}`);
        return { query, hits: [] as SearchHit[] };
      }
    }),
  );

  // Collect unique URLs in stable order, globally bounded BEFORE scraping.
  const seen = new Set<string>();
  const targets: Array<{ url: string; title: string; query: string }> = [];
  for (const { query, hits } of perQueryHits) {
    for (const hit of hits) {
      const url = typeof hit?.url === 'string' ? hit.url.trim() : '';
      if (!url || seen.has(url)) continue;
      seen.add(url);
      targets.push({ url, title: (hit.title || url).trim(), query });
      if (targets.length >= opts.maxSources) break;
    }
    if (targets.length >= opts.maxSources) break;
  }

  const mapBatched = boundaries.mapBatched ?? defaultMapBatched;
  const scraped = await mapBatched(targets, opts.concurrency, async (t) => {
    let content = '';
    try {
      content = await boundaries.scrape(t.url);
    } catch (err) {
      logger.debug(`[deep-research] scrape failed for ${t.url}: ${errMsg(err)}`);
      content = '';
    }
    return { ...t, content: typeof content === 'string' ? content : '' };
  });

  // Drop sources with no usable content (failed/empty scrape).
  return scraped.filter((s) => s.content.trim().length > 0);
}

// ============================================================================
// 3. Pragmatic content dedup (normalize → shingle hashes → Jaccard)
// ============================================================================

/** Unicode-friendly text normalization for fingerprinting. */
function normalizeForFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** FNV-1a 32-bit string hash. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const SHINGLE_WORDS = 4;
const FINGERPRINT_MAX_CHARS = 8000;

/**
 * Content fingerprint: the set of word-shingle hashes over the normalized,
 * length-bounded text. Empty/whitespace input → []. Never throws.
 */
export function contentFingerprint(text: string): number[] {
  try {
    const norm = normalizeForFingerprint(text).slice(0, FINGERPRINT_MAX_CHARS);
    if (!norm) return [];
    const words = norm.split(' ').filter(Boolean);
    if (words.length === 0) return [];
    const k = Math.min(SHINGLE_WORDS, words.length);
    const set = new Set<number>();
    for (let i = 0; i + k <= words.length; i++) {
      set.add(hashString(words.slice(i, i + k).join(' ')));
    }
    if (set.size === 0) set.add(hashString(norm));
    return Array.from(set);
  } catch {
    return [];
  }
}

/** Jaccard similarity of two fingerprint sets, 0..1. Empty either ⇒ 0. */
export function fingerprintSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const x of setB) if (setA.has(x)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Drop near-duplicate sources (compared against ALL previously-kept sources,
 * unlike frame-dedup's consecutive-only rule, since two different queries can
 * surface the same article). Keeps the first occurrence, assigns stable ids
 * 1..M to the kept set. Fail-open: an unfingerprintable source is kept. Never throws.
 */
export function dedupSources(
  sources: Array<Omit<CollectedSource, 'id'>>,
  boundaries: DeepResearchBoundaries,
  opts: ResolvedOptions,
): { kept: CollectedSource[]; dropped: number } {
  const fingerprint = boundaries.fingerprint ?? contentFingerprint;
  const kept: CollectedSource[] = [];
  const keptPrints: number[][] = [];
  let dropped = 0;

  for (const src of sources) {
    let print: number[] = [];
    try {
      print = fingerprint(src.content);
    } catch {
      print = [];
    }
    let isDup = false;
    if (print.length > 0) {
      for (const prev of keptPrints) {
        if (fingerprintSimilarity(print, prev) >= opts.dedupThreshold) {
          isDup = true;
          break;
        }
      }
    }
    if (isDup) {
      dropped++;
      continue;
    }
    kept.push({ ...src, id: kept.length + 1 });
    keptPrints.push(print);
  }

  return { kept, dropped };
}

// ============================================================================
// 4. Citation registry rendering
// ============================================================================

export function toSourceRegistry(sources: CollectedSource[]): SourceRef[] {
  return sources.map((s) => ({ id: s.id, url: s.url, title: s.title }));
}

/** Deterministic numbered references section. Always rendered from the registry. */
export function renderReferences(sources: SourceRef[]): string {
  if (sources.length === 0) {
    return '## Références\n\n_Aucune source citable n\'a pu être collectée._';
  }
  const lines = ['## Références', ''];
  for (const s of sources) {
    lines.push(`[${s.id}] ${s.title} — ${s.url}`);
  }
  return lines.join('\n');
}

/** Strip a trailing references/sources heading the LLM may have added (we own that section). */
function stripTrailingReferences(body: string): string {
  return body.replace(/\n+#{1,6}\s*(références|references|sources|bibliographie)\b[\s\S]*$/i, '').trimEnd();
}

// ============================================================================
// 5. Objective synthesis (cited)
// ============================================================================

const SYNTH_SYSTEM = [
  'You are an objective research synthesizer. Combine the provided sources into a single,',
  'well-structured Markdown report. Requirements:',
  '- Start with a "## TL;DR" of 2-4 sentences.',
  '- Then one "## " section per sub-question, answering it from the sources.',
  '- Aggregate MULTIPLE sources per claim to reduce bias; note disagreements explicitly.',
  '- Cite every non-trivial claim with inline markers like [1], [2] using the given source ids.',
  '- Do NOT invent sources or ids. Do NOT write your own references section — it is appended for you.',
  '- Be concise and factual; no meta-commentary.',
].join('\n');

/**
 * Synthesize the deduped, cited sources into a structured report. One LLM call;
 * deterministic fallback body on failure. The "## Références" section is ALWAYS
 * appended from the registry so citation traceability never depends on the LLM.
 * Never throws.
 */
export async function synthesize(
  question: string,
  plan: DeepQueryPlan,
  sources: CollectedSource[],
  boundaries: DeepResearchBoundaries,
  opts: ResolvedOptions,
): Promise<{ report: string; llmUsed: boolean }> {
  const registry = toSourceRegistry(sources);
  const references = renderReferences(registry);

  if (sources.length === 0) {
    const body = [
      `# Deep Research: ${question}`,
      '',
      '## TL;DR',
      '',
      'Aucune source exploitable n\'a pu être collectée (recherche ou scraping indisponible). Rapport non concluant.',
    ].join('\n');
    return { report: `${body}\n\n${references}`, llmUsed: false };
  }

  const sourceBlock = sources
    .map((s) => `[${s.id}] ${s.title} (${s.url})\n${s.content.slice(0, opts.perSourceChars)}`)
    .join('\n\n---\n\n');

  const subQuestionList = plan.subQuestions.map((sq, i) => `${i + 1}. ${sq.subQuestion}`).join('\n');

  const userPrompt = [
    `Question: ${question}`,
    '',
    'Sub-questions to answer:',
    subQuestionList,
    '',
    'Sources (cite by the bracketed id):',
    '',
    sourceBlock,
  ].join('\n');

  try {
    const raw = await boundaries.llm([
      { role: 'system', content: SYNTH_SYSTEM },
      { role: 'user', content: userPrompt },
    ]);
    const body = stripTrailingReferences((raw || '').trim());
    if (body.length > 0) {
      return { report: `${body}\n\n${references}`, llmUsed: true };
    }
  } catch (err) {
    logger.debug(`[deep-research] synthesis LLM failed: ${errMsg(err)}`);
  }

  return { report: `${buildFallbackBody(question, plan, sources)}\n\n${references}`, llmUsed: false };
}

/** Deterministic report body when the synthesizer LLM is unavailable — still cited. */
function buildFallbackBody(question: string, plan: DeepQueryPlan, sources: CollectedSource[]): string {
  const lines: string[] = [`# Deep Research: ${question}`, '', '## TL;DR', ''];
  lines.push(
    `Synthèse déterministe (LLM indisponible) à partir de ${sources.length} source(s) dédupliquée(s). ` +
      'Chaque section liste les extraits collectés avec leur marqueur de citation.',
  );
  for (const sq of plan.subQuestions) {
    lines.push('', `## ${sq.subQuestion}`, '');
    // Attach every source whose surfacing query belongs to this sub-question.
    const querySet = new Set(sq.queries);
    const related = sources.filter((s) => querySet.has(s.query));
    const chosen = related.length > 0 ? related : sources;
    for (const s of chosen) {
      const excerpt = s.content.replace(/\s+/g, ' ').trim().slice(0, 400);
      lines.push(`- ${excerpt} [${s.id}]`);
    }
  }
  return lines.join('\n');
}

// ============================================================================
// Orchestration entry point (pure — the class method wires real boundaries)
// ============================================================================

/**
 * Run the full Phase-A pipeline. Never throws: every stage degrades gracefully.
 * Emits coarse progress via the optional callback.
 */
export async function runDeepResearchPipeline(
  question: string,
  boundaries: DeepResearchBoundaries,
  options: DeepResearchOptions = {},
  onProgress?: (s: DeepResearchStage) => void,
): Promise<DeepResearchResult> {
  const opts = resolveDeepResearchOptions(options);
  const started = Date.now();
  const emit = (s: DeepResearchStage) => {
    try {
      onProgress?.(s);
    } catch {
      /* progress must never break research */
    }
  };

  emit({ stage: 'planning' });
  const { plan, llmUsed: plannerLlmUsed } = await planQueries(question, boundaries, opts);
  const queryCount = plan.subQuestions.reduce((n, sq) => n + sq.queries.length, 0);
  emit({ stage: 'planned', subQuestions: plan.subQuestions.length, queries: queryCount, llmUsed: plannerLlmUsed });

  let rawSources: Array<Omit<CollectedSource, 'id'>> = [];
  try {
    rawSources = await collectSources(plan, boundaries, opts);
  } catch (err) {
    logger.debug(`[deep-research] collection failed: ${errMsg(err)}`);
    rawSources = [];
  }
  emit({ stage: 'collecting', urls: rawSources.length });

  const { kept, dropped } = dedupSources(rawSources, boundaries, opts);
  emit({ stage: 'collected', scraped: rawSources.length });
  emit({ stage: 'deduped', kept: kept.length, dropped });

  emit({ stage: 'synthesizing' });
  const { report, llmUsed: synthesisLlmUsed } = await synthesize(question, plan, kept, boundaries, opts);

  const result: DeepResearchResult = {
    question,
    plan,
    sources: toSourceRegistry(kept),
    report,
    durationMs: Date.now() - started,
    plannerLlmUsed,
    synthesisLlmUsed,
    duplicatesDropped: dropped,
  };
  emit({ stage: 'done', sources: kept.length });
  return result;
}

// ============================================================================
// Small shared helpers
// ============================================================================

/** Extract the first JSON object OR array substring from an LLM response. */
function extractJsonObject(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const objStart = raw.indexOf('{');
  const arrStart = raw.indexOf('[');
  const candidates: Array<[number, string, string]> = [];
  if (objStart >= 0) candidates.push([objStart, '{', '}']);
  if (arrStart >= 0) candidates.push([arrStart, '[', ']']);
  if (candidates.length === 0) return null;
  // Prefer whichever opening delimiter appears first.
  candidates.sort((a, b) => a[0] - b[0]);
  const [start, , close] = candidates[0]!;
  const end = raw.lastIndexOf(close);
  if (end <= start) return null;
  return raw.slice(start, end + 1);
}

function dedupStrings(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const key = s.trim();
    if (!key || seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    out.push(key);
  }
  return out;
}

async function defaultMapBatched<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  const step = Math.max(1, size);
  for (let i = 0; i < items.length; i += step) {
    const batch = items.slice(i, i + step);
    const results = await Promise.all(batch.map(fn));
    out.push(...results);
  }
  return out;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
