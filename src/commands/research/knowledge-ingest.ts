/**
 * `buddy research ingest|recall|stats` — feed and query the Collective Knowledge Graph (CKG)
 * with real scientific publications. This is the practical entry point of Patrice's vision:
 * study a database of scientific publications, auto-link each discovery to its neighbours, and
 * make the whole thing queryable (cross-lingual) — domain-agnostic (AI, physics, medicine…).
 *
 * Subcommands are attached to the existing `research` command. Handlers are injectable
 * (`deps`) so routing + flow are testable without the network or a model.
 *
 * @module commands/research/knowledge-ingest
 */

import type { Command } from 'commander';
import type { Publication, PublicationSource } from '../../research/publication-sources.js';
import type { RelationClassifier } from '../../memory/collective-knowledge-graph.js';

export interface KnowledgeIngestDeps {
  fetchPublications: (topic: string, opts: { source?: PublicationSource; limit?: number }) => Promise<Publication[]>;
  ingestPublication: (
    pub: Publication,
    opts?: { relationClassifier?: RelationClassifier },
  ) => Promise<{ relations: Array<{ predicate: string }> } | null>;
  recallHybrid: (query: string, opts: { limit?: number }) => Promise<Array<{ text: string; similarity?: number; relations: Array<{ predicate: string }> }>>;
  getStats: () => { entities: number; relations: number; ledgerPath: string };
  /** Build the NLI relation classifier (for --classify). Absent → links stay `related_to`. */
  makeClassifier?: () => RelationClassifier;
  /** Pull Code Explorer code-graph insights as discoveries (for `ingest-code`). */
  fetchCodeInsights?: (opts: { repo?: string }) => Promise<Publication[]>;
  log: (msg: string) => void;
}

async function defaultDeps(): Promise<KnowledgeIngestDeps> {
  const { fetchPublications } = await import('../../research/publication-sources.js');
  const { getCollectiveKnowledgeGraph } = await import('../../memory/collective-knowledge-graph.js');
  const { makeLlmRelationClassifier } = await import('../../research/relation-classifier.js');
  const { fetchCodeExplorerInsights } = await import('../../research/code-explorer-source.js');
  const ckg = getCollectiveKnowledgeGraph();
  return {
    fetchPublications,
    ingestPublication: (pub, opts) => ckg.ingestPublication(pub, opts ?? {}),
    recallHybrid: (query, opts) => ckg.recallHybrid(query, opts),
    getStats: () => ckg.getStats(),
    makeClassifier: () => makeLlmRelationClassifier(),
    fetchCodeInsights: (opts) => fetchCodeExplorerInsights(opts),
    log: (msg) => console.log(msg),
  };
}

function clampInt(value: string | undefined, def: number, min: number, max: number): number {
  const n = parseInt(value ?? '', 10);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : def));
}

/** Ingest publications on a topic into the CKG (auto-linked). Returns counts (for tests). */
export async function runIngest(
  topic: string,
  opts: { limit?: string; source?: string; classify?: boolean },
  deps: KnowledgeIngestDeps,
): Promise<{ ingested: number; linksCreated: number; supports: number; contradicts: number }> {
  const limit = clampInt(opts.limit, 6, 1, 50);
  const source = (['arxiv', 'europepmc', 'both'].includes(opts.source ?? '') ? opts.source : 'both') as PublicationSource;
  deps.log(`🔎 Publications sur « ${topic} » (${source}, max ${limit}/source)…`);
  const pubs = await deps.fetchPublications(topic, { source, limit });
  if (pubs.length === 0) {
    deps.log('Aucune publication récupérée (source injoignable, ou aucun résultat).');
    return { ingested: 0, linksCreated: 0, supports: 0, contradicts: 0 };
  }
  const classifier = opts.classify && deps.makeClassifier ? deps.makeClassifier() : undefined;
  deps.log(`📚 ${pubs.length} publications → ingestion + auto-liage${classifier ? ' + classification supports/contredit' : ''}…\n`);
  let linksCreated = 0;
  let supports = 0;
  let contradicts = 0;
  let ingested = 0;
  for (const p of pubs) {
    const r = await deps.ingestPublication(p, classifier ? { relationClassifier: classifier } : {});
    if (!r) continue;
    ingested++;
    const neighbours = r.relations.filter((x) => ['related_to', 'supports', 'contradicts'].includes(x.predicate));
    linksCreated += neighbours.length;
    supports += neighbours.filter((x) => x.predicate === 'supports').length;
    contradicts += neighbours.filter((x) => x.predicate === 'contradicts').length;
    const tag = neighbours.length ? `  ↔ ${neighbours.length} lien(s)` : '';
    deps.log(`  • ${p.title.slice(0, 78)}${tag}`);
  }
  const s = deps.getStats();
  deps.log(`\n✅ Graphe : ${s.entities} découvertes, ${s.relations} liens${classifier ? ` (${supports} confirment, ${contradicts} contredisent)` : ''}.`);
  deps.log('   Interroge-le : buddy research recall "<question>"');
  return { ingested, linksCreated, supports, contradicts };
}

/** Ingest Code Explorer code-graph insights into the CKG as auto-linked discoveries. */
export async function runIngestCode(
  opts: { repo?: string; classify?: boolean },
  deps: KnowledgeIngestDeps,
): Promise<{ ingested: number; linksCreated: number }> {
  if (!deps.fetchCodeInsights) {
    deps.log('Code Explorer source indisponible.');
    return { ingested: 0, linksCreated: 0 };
  }
  deps.log(`🔎 Insights Code Explorer${opts.repo ? ` (${opts.repo})` : ''}…`);
  const pubs = await deps.fetchCodeInsights(opts.repo ? { repo: opts.repo } : {});
  if (pubs.length === 0) {
    deps.log('Aucun insight (Code Explorer non connecté ? lance `buddy server` ou vérifie mcp.json).');
    return { ingested: 0, linksCreated: 0 };
  }
  const classifier = opts.classify && deps.makeClassifier ? deps.makeClassifier() : undefined;
  deps.log(`📈 ${pubs.length} insight(s) de code → ingestion + auto-liage dans le graphe…\n`);
  let ingested = 0;
  let linksCreated = 0;
  for (const p of pubs) {
    const r = await deps.ingestPublication(p, classifier ? { relationClassifier: classifier } : {});
    if (!r) continue;
    ingested++;
    const links = r.relations.filter((x) => ['related_to', 'supports', 'contradicts'].includes(x.predicate)).length;
    linksCreated += links;
    deps.log(`  • ${p.title}${links ? `  ↔ ${links} lien(s)` : ''}`);
  }
  const s = deps.getStats();
  deps.log(`\n✅ Graphe : ${s.entities} découvertes, ${s.relations} liens.`);
  return { ingested, linksCreated };
}

/** Hybrid query the CKG. Returns the hit count (for tests). */
export async function runRecall(
  query: string,
  opts: { limit?: string },
  deps: KnowledgeIngestDeps,
): Promise<number> {
  const limit = clampInt(opts.limit, 5, 1, 20);
  const hits = await deps.recallHybrid(query, { limit });
  if (hits.length === 0) {
    deps.log('Rien trouvé. Ingère d’abord des publications : buddy research ingest "<sujet>"');
    return 0;
  }
  for (const h of hits) {
    const sim = h.similarity !== undefined ? `[${h.similarity.toFixed(2)}] ` : '';
    deps.log(`${sim}${h.text.slice(0, 160)}`);
    const links = h.relations.filter((r) => r.predicate === 'related_to').length;
    if (links) deps.log(`        ↔ ${links} découverte(s) reliée(s)`);
  }
  return hits.length;
}

/** Attach ingest/recall/stats subcommands to the `research` command. */
export function addKnowledgeSubcommands(cmd: Command, depsFactory: () => Promise<KnowledgeIngestDeps> = defaultDeps): void {
  cmd
    .command('ingest <topic>')
    .description('Fetch scientific publications on a topic and ingest them into the collective knowledge graph (auto-linked)')
    .option('-n, --limit <n>', 'Max publications per source', '6')
    .option('-s, --source <src>', 'Source: arxiv | europepmc | both', 'both')
    .option('--classify', 'Use the LLM to tag neighbour links as supports/contradicts (slower)', false)
    .action(async (topic: string, opts: { limit?: string; source?: string; classify?: boolean }) => {
      await runIngest(topic, opts, await depsFactory());
    });

  cmd
    .command('ingest-code')
    .description('Ingest Code Explorer code-graph insights (hotspots, cycles, …) into the knowledge graph')
    .option('--repo <path>', 'Repo path/id (else the default indexed repo)')
    .option('--classify', 'Tag neighbour links as supports/contradicts (slower)', false)
    .action(async (opts: { repo?: string; classify?: boolean }) => {
      await runIngestCode(opts, await depsFactory());
    });

  cmd
    .command('recall <query>')
    .description('Query the collective knowledge base (hybrid semantic search, cross-lingual)')
    .option('-n, --limit <n>', 'Max results', '5')
    .action(async (query: string, opts: { limit?: string }) => {
      await runRecall(query, opts, await depsFactory());
    });

  cmd
    .command('stats')
    .description('Show the collective knowledge graph size')
    .action(async () => {
      const deps = await depsFactory();
      const s = deps.getStats();
      deps.log(`Graphe de connaissances collectif : ${s.entities} découvertes, ${s.relations} liens.`);
      deps.log(`Ledger : ${s.ledgerPath}`);
    });
}
