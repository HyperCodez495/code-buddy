/**
 * CapabilitiesView — the unified Skills / Tools / MCP page (Hermes-desktop
 * parity: their « Capabilities » page federates the same three surfaces).
 *
 * Cowork had all three as scattered pieces — a full-page skills manager
 * behind ⌘⇧K, tool strips inside the Fleet cockpit, MCP inside Settings.
 * This view federates them behind one rail entry, each tab backed by the
 * REAL data source: the tool registry (`tools.list` IPC), the MCP bridge
 * (`mcp.getServers/getServerStatus/getTools`), and the review-gated skills
 * page component (reused as-is).
 */
import { lazy, Suspense, useState } from 'react';
import { Blocks, Loader2, Plug, Sparkles, Wrench } from 'lucide-react';

import { useAppStore } from '../../store';

const ToolsCatalogPanel = lazy(() => import('./ToolsCatalogPanel.js').then((m) => ({ default: m.ToolsCatalogPanel })));
const McpCapabilitiesPanel = lazy(() => import('./McpCapabilitiesPanel.js').then((m) => ({ default: m.McpCapabilitiesPanel })));
const SkillsManagerPage = lazy(() => import('../skills-manager-page.js').then((m) => ({ default: m.SkillsManagerPage })));

const TABS = [
  { id: 'tools', label: 'Outils', icon: Wrench },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'mcp', label: 'MCP', icon: Plug },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function CapabilitiesView() {
  const [active, setActive] = useState<TabId>('tools');
  const workingDir = useAppStore((s) => s.workingDir);

  return (
    <main className="flex h-full min-h-0 flex-col bg-background text-foreground" data-testid="capabilities-view">
      <header className="flex shrink-0 items-center gap-1 border-b border-border bg-surface px-3 py-2">
        <Blocks className="mr-1 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h1 className="mr-3 text-sm font-semibold">Capacités</h1>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActive(id)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs ${
              active === id ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-background hover:text-foreground'
            }`}
            data-testid={`capabilities-tab-${id}`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </button>
        ))}
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            </div>
          }
        >
          {active === 'tools' && <ToolsCatalogPanel />}
          {active === 'mcp' && <McpCapabilitiesPanel />}
          {active === 'skills' && (
            <div className="h-full overflow-y-auto">
              <SkillsManagerPage onClose={() => setActive('tools')} cwd={workingDir || undefined} />
            </div>
          )}
        </Suspense>
      </div>
    </main>
  );
}
