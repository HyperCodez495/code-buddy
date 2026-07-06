/**
 * McpCapabilitiesPanel — configured MCP servers with live status and the
 * tools each one exposes. Read view of the real `mcp.*` bridge; editing
 * stays in Settings → MCP (one editor, no duplicated forms).
 */
import { useCallback, useEffect, useState } from 'react';
import { CircleCheck, CircleDashed, CircleX, Plug, RefreshCw, Settings } from 'lucide-react';

import { useAppStore } from '../../store';
import type { McpServerConfig, McpServerStatus, McpTool } from '../../../shared/ipc-types';

function statusIcon(status: McpServerStatus | undefined) {
  if (!status || status.status === 'disabled') return <CircleDashed className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
  if (status.connected) return <CircleCheck className="h-4 w-4 text-success" aria-hidden="true" />;
  if (status.status === 'connecting') return <RefreshCw className="h-4 w-4 animate-spin text-warning" aria-hidden="true" />;
  return <CircleX className="h-4 w-4 text-destructive" aria-hidden="true" />;
}

export function McpCapabilitiesPanel() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [statuses, setStatuses] = useState<Map<string, McpServerStatus>>(new Map());
  const [tools, setTools] = useState<McpTool[]>([]);
  const [loaded, setLoaded] = useState(false);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const setSettingsTab = useAppStore((s) => s.setSettingsTab);

  const refresh = useCallback(() => {
    const api = window.electronAPI?.mcp;
    if (!api) {
      setLoaded(true);
      return;
    }
    void Promise.allSettled([api.getServers(), api.getServerStatus(), api.getTools()]).then(
      ([serversResult, statusResult, toolsResult]) => {
        if (serversResult.status === 'fulfilled' && Array.isArray(serversResult.value)) setServers(serversResult.value);
        if (statusResult.status === 'fulfilled' && Array.isArray(statusResult.value)) {
          setStatuses(new Map(statusResult.value.map((s) => [s.id, s])));
        }
        if (toolsResult.status === 'fulfilled' && Array.isArray(toolsResult.value)) setTools(toolsResult.value);
        setLoaded(true);
      },
    );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="h-full overflow-y-auto p-4" data-testid="mcp-capabilities-panel">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Serveurs MCP configurés — statut live et outils exposés. L'édition se fait dans Réglages → MCP.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={refresh}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-muted-foreground hover:text-foreground"
              data-testid="mcp-refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Rafraîchir
            </button>
            <button
              type="button"
              onClick={() => {
                setSettingsTab('mcp');
                setShowSettings(true);
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-muted-foreground hover:text-foreground"
            >
              <Settings className="h-3.5 w-3.5" aria-hidden="true" />
              Configurer
            </button>
          </div>
        </div>

        {loaded && servers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun serveur MCP configuré.</p>
        ) : null}

        {servers.map((server) => {
          const status = statuses.get(server.id);
          const serverTools = tools.filter((t) => t.serverId === server.id);
          return (
            <section key={server.id} className="rounded-lg border border-border bg-surface p-3" data-testid={`mcp-server-${server.name}`}>
              <div className="flex items-center gap-2">
                {statusIcon(status)}
                <Plug className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm font-semibold text-foreground">{server.name}</span>
                <span className="text-xs text-muted-foreground">{server.type}</span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {status?.toolCount ?? serverTools.length} outil{(status?.toolCount ?? serverTools.length) > 1 ? 's' : ''}
                </span>
              </div>
              {serverTools.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {serverTools.map((tool) => (
                    <code key={tool.name} title={tool.description} className="rounded bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {tool.name}
                    </code>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
