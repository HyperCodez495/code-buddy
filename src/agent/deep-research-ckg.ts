/**
 * Deep Research — Phase D (Collective Knowledge Graph bridge).
 *
 * Phases A/B/C produce a self-contained cited report from FRESH web sources and
 * then forget everything. The Collective Knowledge Graph (`memory/collective-
 * knowledge-graph.ts`) is the collective's SHARED, cross-run/cross-agent memory
 * — an append-only ledger whose `ingest()` auto-links a discovery to its nearest
 * neighbours (supports / contradicts / related_to) and CORROBORATES a fact that
 * several independent agents find, and whose `recallHybrid()` retrieves prior
 * knowledge with local embeddings ($0, no LLM at retrieval).
 *
 * Today the two are DISCONNECTED: a Deep Research run neither feeds the graph nor
 * consults what the collective already knows. Phase D bridges them, both ways and
 * both OPT-IN:
 *
 *   1. INGEST (write)  — at the END of a run, the deduped web sources are ingested
 *                        into the CKG (one `discovery` node each, url as stable
 *                        name + a bounded excerpt as text). Benefits: accumulation
 *                        across runs, auto-linking, and corroboration when several
 *                        runs/agents surface the same fact. Idempotent by design:
 *                        the CKG dedups on contentHash (same url + same excerpt →
 *                        reinforce, not duplicate), and we fingerprint-dedup the
 *                        batch first (reusing Phase-A `contentFingerprint`).
 *   2. RECALL (read)   — at the START of a run, the collective's prior knowledge
 *                        for the question is recalled (bounded top-K) and injected
 *                        into the produced report as a DISTINCTLY-MARKED
 *                        "## Mémoire collective" section with its own `[Mk]`
 *                        citation namespace — never confused with a fresh web
 *                        source.
 *
 * STRICTLY ADDITIVE / never-throws: with the bridge absent or `enabled: false`
 * the wrapper delegates to the base A/B/C runner VERBATIM — no recall, no ingest,
 * an untouched report/sources (byte-identical). The single side-effecting edge —
 * the CKG itself — is the INJECTABLE `CkgBridge`, so the whole pipeline is unit-
 * testable with zero ledger / zero network. Any bridge failure (recall or ingest)
 * degrades silently: the research continues normally. The CKG is a bonus, never a
 * hard dependency.
 *
 * @module agent/deep-research-ckg
 */

import { logger } from '../utils/logger.js';
import { contentFingerprint, fingerprintSimilarity, type DeepResearchResult } from './deep-research.js';

// ============================================================================
// Data types
// ============================================================================

/** A piece of prior collective knowledge recalled from the CKG (already-collected). */
export interface CkgMemorySource {
  /** The CKG node id (provenance). */
  id: string;
  /** The knowledge text. */
  text: string;
  /** Node type ('discovery' | 'fact' | 'lesson' | …). */
  type?: string;
  /** The agent that contributed it (attribution). */
  agentId?: string;
  /** Provenance tag ('deep-research' | 'publication' | …). */
  source?: string;
  /** Semantic similarity to the query (0..1) when the recall provided it. */
  similarity?: number;
}

/** A deduped web source (with a content excerpt) that a run will ingest into the CKG. */
export interface CkgIngestableSource {
  url: string;
  title: string;
  content: string;
}

/** Metadata attached to every ingested node. */
export interface CkgIngestMeta {
  /** The research question (audit / provenance). */
  question: string;
  /** Provenance tag written on each node. */
  source: string;
  /** Contributing agent id (attribution). */
  agentId?: string;
}

/**
 * The ONLY seam Phase D needs — an injectable adapter over the Collective
 * Knowledge Graph. The real implementation wraps `CollectiveKnowledgeGraph`
 * (`recallHybrid` / `ingest`); tests inject a fake so nothing touches a ledger.
 * Both methods are expected to never throw (impls guard), but the wrapper guards
 * them anyway.
 */
export interface CkgBridge {
  /** Recall up to `k` prior knowledge entries for `query`. Returns [] on any failure. */
  recall(query: string, k: number): Promise<CkgMemorySource[]>;
  /** Ingest the deduped sources as discovery nodes. Returns how many were stored. */
  ingest(sources: CkgIngestableSource[], meta: CkgIngestMeta): Promise<number>;
}

/** Phase-D activation + tuning (all bounded). */
export interface CkgRunOptions {
  /** Master switch. `false`/absent ⇒ the base A/B/C run is byte-identical. */
  enabled: boolean;
  /** The CKG adapter. Absent ⇒ Phase D is inert even when `enabled` (fail-open). */
  bridge?: CkgBridge;
  /** Top-K recall bound (default 6, clamped [1, 20]). */
  recallLimit?: number;
  /** Per-source excerpt chars fed to ingest (default 600, clamped [120, 4000]). */
  ingestExcerptChars?: number;
  /** Contributing agent id written on ingested nodes (attribution). */
  agentId?: string;
  /** Provenance tag written on ingested nodes (default 'deep-research'). */
  sourceTag?: string;
}

/** What Phase D did on a run (surfaced on the result for CLI rendering / tests). */
export interface CkgOutcome {
  enabled: boolean;
  /** Number of prior-knowledge entries recalled + injected into the report. */
  recalled: number;
  /** Number of web sources ingested into the collective graph. */
  ingested: number;
  /** The recalled knowledge (for rendering / assertions). */
  memory: CkgMemorySource[];
}

const DEFAULT_RECALL_LIMIT = 6;
const RECALL_LIMIT_MAX = 20;
const DEFAULT_EXCERPT_CHARS = 600;
const EXCERPT_CHARS_MIN = 120;
const EXCERPT_CHARS_MAX = 4000;
/** Near-duplicate excerpts collapse in the ingest batch (reuse Phase-A dedup threshold). */
const INGEST_DEDUP_THRESHOLD = 0.8;

function clampInt(v: number | undefined, def: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(min, Math.min(max, n));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// ============================================================================
// Recall (read) — bounded, never-throws
// ============================================================================

/**
 * Recall prior collective knowledge for `query`, bounded to top-K. Never throws:
 * a bridge failure (or an unusable payload) yields []. The results are cleaned
 * (non-empty text) and hard-capped at K.
 */
export async function recallCollectiveMemory(
  bridge: CkgBridge,
  query: string,
  limit?: number,
): Promise<CkgMemorySource[]> {
  const k = clampInt(limit, DEFAULT_RECALL_LIMIT, 1, RECALL_LIMIT_MAX);
  const q = (query ?? '').trim();
  if (!q) return [];
  try {
    const hits = await bridge.recall(q, k);
    if (!Array.isArray(hits)) return [];
    return hits
      .filter((h): h is CkgMemorySource => !!h && typeof h.text === 'string' && h.text.trim().length > 0)
      .slice(0, k);
  } catch (err) {
    logger.debug(`[deep-research-ckg] recall failed: ${errMsg(err)}`);
    return [];
  }
}

// ============================================================================
// Ingest (write) — bounded, idempotent, never-throws
// ============================================================================

/**
 * Fingerprint-dedup + excerpt-bound an ingest batch (reuses the Phase-A
 * `contentFingerprint`/Jaccard so a near-duplicate excerpt is not re-ingested).
 * The batch is already URL-unique and Phase-A-deduped upstream; this is a cheap
 * belt-and-suspenders pass. Fail-open: an unfingerprintable source is kept.
 */
export function prepareIngestBatch(
  sources: CkgIngestableSource[],
  excerptChars: number,
): CkgIngestableSource[] {
  const out: CkgIngestableSource[] = [];
  const prints: number[][] = [];
  const seenUrls = new Set<string>();
  for (const s of sources) {
    const url = typeof s?.url === 'string' ? s.url.trim() : '';
    const content = typeof s?.content === 'string' ? collapseWhitespace(s.content) : '';
    if (!url || !content || seenUrls.has(url)) continue;
    let print: number[] = [];
    try {
      print = contentFingerprint(content);
    } catch {
      print = [];
    }
    let isDup = false;
    if (print.length > 0) {
      for (const prev of prints) {
        if (fingerprintSimilarity(print, prev) >= INGEST_DEDUP_THRESHOLD) {
          isDup = true;
          break;
        }
      }
    }
    if (isDup) continue;
    seenUrls.add(url);
    prints.push(print);
    out.push({ url, title: collapseWhitespace(s.title ?? url) || url, content: content.slice(0, excerptChars) });
  }
  return out;
}

/**
 * Ingest the deduped sources into the collective graph. Bounded to the batch
 * size (itself capped by Phase A), never throws (a bridge failure yields 0).
 */
export async function ingestCollectedSources(
  bridge: CkgBridge,
  sources: CkgIngestableSource[],
  meta: CkgIngestMeta,
  excerptChars?: number,
): Promise<number> {
  const chars = clampInt(excerptChars, DEFAULT_EXCERPT_CHARS, EXCERPT_CHARS_MIN, EXCERPT_CHARS_MAX);
  const batch = prepareIngestBatch(Array.isArray(sources) ? sources : [], chars);
  if (batch.length === 0) return 0;
  try {
    const n = await bridge.ingest(batch, meta);
    return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(batch.length, Math.floor(n))) : 0;
  } catch (err) {
    logger.debug(`[deep-research-ckg] ingest failed: ${errMsg(err)}`);
    return 0;
  }
}

// ============================================================================
// Report augmentation — recalled memory injected, cited distinctly
// ============================================================================

/**
 * Inject the recalled collective knowledge into the report as a DISTINCT
 * "## Mémoire collective" section, placed just before "## Références" so the web
 * references stay last. Each entry gets a `[Mk]` marker — a separate citation
 * namespace from the web `[n]` markers — and carries its provenance (agent /
 * source / similarity), so recalled knowledge is never confused with a fresh web
 * source. Empty memory ⇒ the report is returned untouched.
 */
export function augmentReportWithMemory(report: string, memory: CkgMemorySource[]): string {
  if (!Array.isArray(memory) || memory.length === 0) return report;
  const lines: string[] = [
    '## Mémoire collective',
    '',
    '_Savoir déjà collecté par le collectif (graphe de connaissances), distinct des sources web fraîches ci-dessus._',
    '',
  ];
  memory.forEach((m, i) => {
    const who = m.agentId ? ` — par ${m.agentId}` : '';
    const src = m.source ? `, source ${m.source}` : '';
    const sim = typeof m.similarity === 'number' && Number.isFinite(m.similarity) ? ` (sim ${m.similarity.toFixed(2)})` : '';
    lines.push(`- [M${i + 1}] ${collapseWhitespace(m.text)}${who}${src}${sim}`);
  });
  const block = lines.join('\n');

  const idx = report.indexOf('## Références');
  if (idx >= 0) {
    const head = report.slice(0, idx).replace(/\s+$/, '');
    const tail = report.slice(idx);
    return `${head}\n\n${block}\n\n${tail}`;
  }
  return `${report.replace(/\s+$/, '')}\n\n${block}`;
}

// ============================================================================
// Orchestration wrapper (pure — the class method wires the real bridge)
// ============================================================================

export interface RunWithCkgParams<TResult extends DeepResearchResult> {
  /** The research question (recall query + ingest provenance). */
  question: string;
  /** Phase-D activation + tuning. */
  options: CkgRunOptions;
  /** Runs the base A/B/C pipeline (already wired with real/teed boundaries). */
  runBase: () => Promise<TResult>;
  /** Maps the base result to the ingestable web sources (url + title + captured content). */
  collectSourcesForIngest: (result: TResult) => CkgIngestableSource[];
}

/**
 * Wrap a base Deep Research run (Phase A/B/C) with the CKG bridge. When Phase D
 * is OFF (bridge absent or `enabled: false`) the base runner is delegated to
 * VERBATIM — no recall, no ingest, the report/sources untouched (byte-identical).
 * When ON: recall (start) → base run → ingest the deduped sources (end) → augment
 * the report with the recalled memory, and attach a `ckg` outcome. Never throws:
 * recall and ingest degrade silently, the base research is always returned.
 */
export async function runDeepResearchWithCkg<TResult extends DeepResearchResult>(
  params: RunWithCkgParams<TResult>,
): Promise<TResult & { ckg?: CkgOutcome }> {
  const { question, options, runBase, collectSourcesForIngest } = params;

  // OFF / no bridge → byte-identical: base result verbatim, NO recall, NO ingest.
  if (!options.enabled || !options.bridge) {
    return runBase();
  }
  const bridge = options.bridge;

  // RECALL (read) — at the START, bounded, never-throws.
  const memory = await recallCollectiveMemory(bridge, question, options.recallLimit);

  // Base A/B/C run (unchanged).
  const result = await runBase();

  // INGEST (write) — the deduped web sources, bounded to the run's source count.
  let ingested = 0;
  try {
    const ingestable = collectSourcesForIngest(result);
    ingested = await ingestCollectedSources(
      bridge,
      ingestable,
      {
        question,
        source: options.sourceTag ?? 'deep-research',
        ...(options.agentId ? { agentId: options.agentId } : {}),
      },
      options.ingestExcerptChars,
    );
  } catch (err) {
    logger.debug(`[deep-research-ckg] ingest phase failed: ${errMsg(err)}`);
    ingested = 0;
  }

  // Inject the recalled memory into the report, cited distinctly.
  const report = augmentReportWithMemory(result.report, memory);
  const outcome: CkgOutcome = { enabled: true, recalled: memory.length, ingested, memory };
  return { ...result, report, ckg: outcome };
}

// ============================================================================
// Small shared helpers
// ============================================================================

/**
 * Resolve Phase-D activation from the CLI flag and/or the shared env gate.
 * `--ckg` OR `CODEBUDDY_COLLECTIVE_MEMORY=true` enables the bridge — the SAME
 * gate the rest of the app uses, so activation is consistent. Absent ⇒ off.
 */
export function resolveCkgEnabled(opts: { ckg?: boolean } = {}, env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(opts.ckg) || env.CODEBUDDY_COLLECTIVE_MEMORY === 'true';
}

/**
 * Wrap a boundaries object so its `scrape` TEES the fetched content into `sink`
 * (keyed by url), leaving every other boundary (llm/search/fingerprint/mapBatched
 * and the STORM seams) untouched. This is how Phase D captures the per-source
 * content the base pipeline drops from its `SourceRef[]` result — WITHOUT
 * touching the A/B/C pipeline. Applied only on the CKG-enabled path. Never throws
 * beyond what the underlying scrape throws (which the pipeline already guards).
 */
export function teeScrapeBoundary<B extends { scrape: (url: string) => Promise<string> }>(
  boundaries: B,
  sink: Map<string, string>,
): B {
  const originalScrape = boundaries.scrape.bind(boundaries);
  return {
    ...boundaries,
    scrape: async (url: string): Promise<string> => {
      const content = await originalScrape(url);
      if (typeof content === 'string' && content.trim().length > 0) sink.set(url, content);
      return content;
    },
  };
}
