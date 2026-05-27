/**
 * SettingsMCPPlayground — Phase 3 step 7
 *
 * Pick any installed MCP tool, enter JSON arguments, invoke and
 * see the structured response with timing. Useful for validating
 * new MCP servers without leaving the GUI.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Play, Wrench, ChevronRight } from 'lucide-react';

interface MCPTool {
  name: string;
  description?: string;
  serverId: string;
  serverName: string;
  inputSchema?: unknown;
}

interface InvokeResult {
  success: boolean;
  durationMs: number;
  result?: unknown;
  error?: string;
}

function tryStringifySchema(schema: unknown): string {
  if (!schema) return '{}';
  try {
    return JSON.stringify(schema, null, 2);
  } catch {
    return '{}';
  }
}

function schemaExample(schema: unknown): string {
  if (!schema || typeof schema !== 'object') return '{}';
  const s = schema as { properties?: Record<string, { type?: string }> };
  if (!s.properties) return '{}';
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(s.properties)) {
    const t = (prop as { type?: string }).type;
    if (t === 'string') out[key] = '';
    else if (t === 'number' || t === 'integer') out[key] = 0;
    else if (t === 'boolean') out[key] = false;
    else if (t === 'array') out[key] = [];
    else if (t === 'object') out[key] = {};
    else out[key] = null;
  }
  return JSON.stringify(out, null, 2);
}

export function SettingsMCPPlayground() {
  const { t } = useTranslation();
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<MCPTool | null>(null);
  const [argsJson, setArgsJson] = useState('{}');
  const [result, setResult] = useState<InvokeResult | null>(null);
  const [running, setRunning] = useState(false);
  const [argsError, setArgsError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!window.electronAPI?.mcp?.listAllTools) return;
    setLoading(true);
    try {
      const list = (await window.electronAPI.mcp.listAllTools()) as MCPTool[];
      setTools(list);
      if (!selectedServerId && list.length > 0) setSelectedServerId(list[0].serverId);
    } finally {
      setLoading(false);
    }
  }, [selectedServerId]);

  useEffect(() => {
    load();
  }, [load]);

  const serversById = useMemo(() => {
    const map = new Map<string, { id: string; name: string; tools: MCPTool[] }>();
    for (const tool of tools) {
      let group = map.get(tool.serverId);
      if (!group) {
        group = { id: tool.serverId, name: tool.serverName, tools: [] };
        map.set(tool.serverId, group);
      }
      group.tools.push(tool);
    }
    return map;
  }, [tools]);

  const selectedServer = selectedServerId ? serversById.get(selectedServerId) : null;

  useEffect(() => {
    if (!selectedTool && selectedServer && selectedServer.tools.length > 0) {
      setSelectedTool(selectedServer.tools[0]);
    }
  }, [selectedServer, selectedTool]);

  useEffect(() => {
    if (selectedTool) {
      setArgsJson(schemaExample(selectedTool.inputSchema));
      setResult(null);
      setArgsError(null);
    }
  }, [selectedTool]);

  const handleInvoke = async () => {
    if (!selectedTool || !window.electronAPI?.mcp?.invokeTool) return;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = argsJson.trim() ? JSON.parse(argsJson) : {};
      setArgsError(null);
    } catch (err) {
      setArgsError((err as Error).message);
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const res = await window.electronAPI.mcp.invokeTool(selectedTool.name, parsed);
      setResult(res as InvokeResult);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="settings-mcp-playground">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">{t('mcpPlayground.title')}</h3>
        <p className="text-xs text-text-muted mt-1">{t('mcpPlayground.hint')}</p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Loader2 size={12} className="animate-spin" />
          {t('common.loading')}
        </div>
      )}

      {!loading && tools.length === 0 && (
        <div className="px-4 py-6 text-xs text-text-muted border border-border rounded-lg text-center">
          {t('mcpPlayground.noTools')}
        </div>
      )}

      {!loading && tools.length > 0 && (
        <div className="grid grid-cols-[200px_1fr] gap-3 min-h-[400px]">
          {/* Server/tool picker */}
          <div className="border border-border rounded-lg overflow-y-auto">
            {Array.from(serversById.values()).map((server) => (
              <div key={server.id} className="border-b border-border-muted last:border-b-0">
                <div className="px-3 py-2 bg-surface/50">
                  <p className="text-xs font-medium text-text-secondary truncate">
                    {server.name}
                  </p>
                </div>
                {server.tools.map((tool) => (
                  <button
                    key={tool.name}
                    onClick={() => {
                      setSelectedServerId(server.id);
                      setSelectedTool(tool);
                    }}
                    data-testid={`mcp-tool-${tool.name}`}
                    className={`w-full text-left px-3 py-1.5 flex items-center gap-1.5 transition-colors ${
                      selectedTool?.name === tool.name
                        ? 'bg-accent/10 text-accent'
                        : 'hover:bg-surface-hover text-text-primary'
                    }`}
                  >
                    <Wrench size={10} className="shrink-0" />
                    <span className="text-xs truncate">{tool.name.replace(/^mcp__[^_]+__/, '')}</span>
                    {selectedTool?.name === tool.name && (
                      <ChevronRight size={10} className="ml-auto shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Invoker */}
          <div className="border border-border rounded-lg p-4 space-y-3">
            {selectedTool ? (
              <>
                <div>
                  <h4 className="text-sm font-semibold text-text-primary">
                    {selectedTool.name.replace(/^mcp__[^_]+__/, '')}
                  </h4>
                  {selectedTool.description && (
                    <p className="text-xs text-text-muted mt-1">{selectedTool.description}</p>
                  )}
                </div>

                <details className="group">
                  <summary className="text-xs text-text-muted cursor-pointer hover:text-text-primary">
                    {t('mcpPlayground.showSchema')}
                  </summary>
                  <pre className="mt-2 p-2 rounded-md bg-surface text-[11px] font-mono text-text-muted overflow-x-auto max-h-40 overflow-y-auto">
                    {tryStringifySchema(selectedTool.inputSchema)}
                  </pre>
                </details>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-secondary">
                    {t('mcpPlayground.argsLabel')}
                  </label>
                  <textarea
                    value={argsJson}
                    onChange={(ev) => {
                      setArgsJson(ev.target.value);
                      setArgsError(null);
                    }}
                    data-testid="mcp-playground-args"
                    rows={8}
                    className="w-full px-3 py-2 rounded-md bg-surface border border-border text-xs text-text-primary focus:outline-none focus:border-accent font-mono"
                  />
                  {argsError && (
                    <p className="text-[11px] text-error">{argsError}</p>
                  )}
                </div>

                <div className="flex items-center justify-end">
                  <button
                    onClick={handleInvoke}
                    disabled={running}
                    data-testid="mcp-playground-run"
                    className="flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
                  >
                    {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                    {running ? t('mcpPlayground.running') : t('mcpPlayground.run')}
                  </button>
                </div>

                {result && (
                  <div
                    data-testid="mcp-playground-result"
                    className={`rounded-md border p-3 text-xs space-y-2 ${
                      result.success
                        ? 'bg-success/5 border-success/30'
                        : 'bg-error/5 border-error/30'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`font-medium ${
                          result.success ? 'text-success' : 'text-error'
                        }`}
                      >
                        {result.success ? t('mcpPlayground.success') : t('mcpPlayground.failure')}
                      </span>
                      <span className="text-text-muted">{result.durationMs}ms</span>
                    </div>
                    {result.error && (
                      <p className="text-error font-mono whitespace-pre-wrap">{result.error}</p>
                    )}
                    {result.result !== undefined && (
                      <pre className="p-2 rounded bg-background border border-border text-[11px] font-mono overflow-x-auto max-h-80 overflow-y-auto">
                        {JSON.stringify(result.result, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-text-muted">{t('mcpPlayground.selectTool')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
