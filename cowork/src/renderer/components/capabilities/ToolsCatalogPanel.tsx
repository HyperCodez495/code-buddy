/**
 * ToolsCatalogPanel — the agent's REAL tool registry, full page.
 *
 * Backed by the `tools.list` IPC (the same registry the agent dispatches
 * from), grouped by category with a search box. Read-only by design: tool
 * availability is governed by permission modes and the RAG selection, not by
 * hand-toggles — this page answers « qu'est-ce que l'agent sait faire ? ».
 */
import { useEffect, useMemo, useState } from 'react';
import { Search, Wrench } from 'lucide-react';

interface ToolEntry {
  name: string;
  description: string;
  category: string;
}

export function ToolsCatalogPanel() {
  const [tools, setTools] = useState<ToolEntry[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI?.tools
      ?.list()
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setTools(list);
      })
      .catch(() => {
        if (!cancelled) setTools([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (tools ?? []).filter(
      (t) => !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
    );
    const byCategory = new Map<string, ToolEntry[]>();
    for (const tool of filtered) {
      const cat = tool.category || 'divers';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(tool);
    }
    return [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [tools, query]);

  const total = tools?.length ?? 0;
  const shown = groups.reduce((n, [, list]) => n + list.length, 0);

  return (
    <div className="h-full overflow-y-auto p-4" data-testid="tools-catalog-panel">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un outil…"
              className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm focus:border-accent focus:outline-none"
              data-testid="tools-catalog-search"
            />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {tools === null ? '…' : `${shown} / ${total} outils`}
          </span>
        </div>

        {tools !== null && total === 0 ? (
          <p className="text-sm text-muted-foreground">
            Registre indisponible — le moteur embarqué n'est pas chargé.
          </p>
        ) : null}

        {groups.map(([category, list]) => (
          <section key={category}>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {category} · {list.length}
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {list.map((tool) => (
                <div key={tool.name} className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-center gap-2">
                    <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <code className="truncate text-xs font-semibold text-foreground">{tool.name}</code>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{tool.description}</p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
