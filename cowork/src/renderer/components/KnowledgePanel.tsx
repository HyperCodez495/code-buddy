/**
 * KnowledgePanel — the read-only window onto Code Buddy's Collective Knowledge Graph (CKG), plus
 * management of the research-ingest topic set. Opened from the new-shell Labs launcher and ⌘K.
 *
 * The CKG is the agent collective's shared memory: ingested research papers/code insights (type
 * `discovery`), lessons, decisions and facts, each with a corroboration confidence. This panel only
 * *shows* the graph and edits the ingest topics — the actual ingestion/recall stays a core concern
 * (`buddy research`). Data comes from the `knowledge.*` IPC; nothing here loads an embedding model.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  groupByType,
  typeLabel,
  confidencePct,
  shortDate,
  normalizeTopic,
  type KnowledgeEntity,
  type KnowledgeStats,
} from './knowledge-panel-helpers';

interface KnowledgeApi {
  stats: () => Promise<KnowledgeStats | null>;
  list: (opts?: { limit?: number; type?: string }) => Promise<KnowledgeEntity[]>;
  topicsList: () => Promise<string[]>;
  topicsAdd: (topic: string) => Promise<string[]>;
  topicsRemove: (topic: string) => Promise<string[]>;
}

function knowledgeApi(): KnowledgeApi | undefined {
  return (window as unknown as { electronAPI?: { ckg?: KnowledgeApi } }).electronAPI?.ckg;
}

export function KnowledgePanel({ onClose }: { onClose: () => void }) {
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [entities, setEntities] = useState<KnowledgeEntity[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTopic, setNewTopic] = useState('');
  const [busyTopic, setBusyTopic] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const api = knowledgeApi();
      if (!api) {
        setError('API Connaissances indisponible.');
        return;
      }
      const [s, e, t] = await Promise.all([api.stats(), api.list({ limit: 300 }), api.topicsList()]);
      setStats(s);
      setEntities(Array.isArray(e) ? e : []);
      setTopics(Array.isArray(t) ? t : []);
    } catch {
      setError('Impossible de lire la mémoire collective.');
      setEntities([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addTopic = useCallback(async () => {
    const topic = normalizeTopic(newTopic);
    if (!topic) return;
    const api = knowledgeApi();
    if (!api) return;
    setBusyTopic(true);
    try {
      const next = await api.topicsAdd(topic);
      setTopics(Array.isArray(next) ? next : topics);
      setNewTopic('');
    } finally {
      setBusyTopic(false);
    }
  }, [newTopic, topics]);

  const removeTopic = useCallback(async (topic: string) => {
    const api = knowledgeApi();
    if (!api) return;
    setBusyTopic(true);
    try {
      const next = await api.topicsRemove(topic);
      setTopics(Array.isArray(next) ? next : topics);
    } finally {
      setBusyTopic(false);
    }
  }, [topics]);

  const groups = groupByType(entities);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-lg shadow-xl w-[860px] max-w-[93vw] max-h-[86vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <span className="font-semibold">Connaissances — mémoire collective</span>
          {stats && (
            <span className="text-xs text-muted-foreground">
              {stats.entities} entités · {stats.relations} relations
              {stats.superseded > 0 ? ` · ${stats.superseded} obsolètes` : ''}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="text-xs px-2 py-1 rounded-md border border-border hover:bg-accent"
            >
              ↻ Rafraîchir
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-xs px-2 py-1 rounded-md border border-border hover:bg-accent"
            >
              Fermer
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-4 space-y-5">
          {/* Research ingest topics — the subjects the auto-ingest daemon studies. */}
          <section>
            <h3 className="text-sm font-semibold mb-1">Sujets à indexer</h3>
            <p className="text-xs text-muted-foreground mb-2">
              Les thèmes que le démon de recherche étudie et ingère dans le graphe (`buddy research`).
            </p>
            <div className="flex items-center gap-2 mb-2">
              <input
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addTopic();
                }}
                placeholder="Ajouter un sujet (ex. agentic RAG, MoE routing)…"
                className="flex-1 text-sm px-2 py-1 rounded-md bg-background border border-border focus:outline-none focus:ring-1 focus:ring-accent"
                data-testid="knowledge-topic-input"
              />
              <button
                type="button"
                onClick={() => void addTopic()}
                disabled={busyTopic || !normalizeTopic(newTopic)}
                className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent disabled:opacity-40"
              >
                Ajouter
              </button>
            </div>
            {topics.length === 0 ? (
              <div className="text-xs text-muted-foreground">Aucun sujet — ajoute-en un ci-dessus.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {topics.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-accent/40 border border-border"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => void removeTopic(t)}
                      disabled={busyTopic}
                      aria-label={`Retirer ${t}`}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* Indexed entities, grouped by type (discoveries lead). */}
          <section>
            <h3 className="text-sm font-semibold mb-2">Entités indexées</h3>
            {loading ? (
              <div className="text-sm text-muted-foreground">Chargement…</div>
            ) : error ? (
              <div className="text-sm text-red-400">{error}</div>
            ) : groups.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Rien d'indexé pour l'instant. Lance `buddy research "&lt;sujet&gt;"` ou ajoute un sujet ci-dessus.
              </div>
            ) : (
              <div className="space-y-4">
                {groups.map((g) => (
                  <div key={g.type}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      {typeLabel(g.type)} <span className="font-normal">· {g.entities.length}</span>
                    </div>
                    <ul className="space-y-1">
                      {g.entities.slice(0, 100).map((e) => (
                        <li
                          key={e.id}
                          className="flex items-start gap-2 text-sm px-2 py-1 rounded-md hover:bg-accent/40"
                        >
                          <span className="flex-1 min-w-0">
                            <span className="truncate">{e.name}</span>
                            {e.source && (
                              <span className="text-xs text-muted-foreground"> — {e.source}</span>
                            )}
                          </span>
                          <span
                            className="text-xs text-muted-foreground shrink-0 tabular-nums"
                            title={`Confiance ${confidencePct(e.confidence)}% · ${e.mentions} mention(s) · ${e.contributors} contributeur(s)`}
                          >
                            {confidencePct(e.confidence)}%{shortDate(e.createdAt) ? ` · ${shortDate(e.createdAt)}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          {stats?.ledgerPath && (
            <div className="text-[10px] text-muted-foreground/70 truncate" title={stats.ledgerPath}>
              Ledger : {stats.ledgerPath}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
