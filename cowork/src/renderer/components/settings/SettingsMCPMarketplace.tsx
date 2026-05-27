/**
 * SettingsMCPMarketplace — Claude Cowork parity Phase 2
 *
 * Browse, install, and manage MCP servers from the curated marketplace
 * registry. Complements the existing Connectors tab which manages manually
 * configured servers.
 *
 * @module renderer/components/settings/SettingsMCPMarketplace
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SettingsMCPPlayground } from './SettingsMCPPlayground';
import { useTranslation } from 'react-i18next';
import {
  Search,
  Download,
  Trash2,
  Power,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Wrench,
} from 'lucide-react';

interface MCPMarketplaceItem {
  id: string;
  name: string;
  description: string;
  category: string;
  bundled: boolean;
  tags: string[];
  type: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  requiresEnv?: string[];
  envDescription?: Record<string, string>;
  homepage?: string;
  publisher?: string;
  installed: boolean;
  installedServerId?: string;
  enabled?: boolean;
}

interface MCPToolSummary {
  name: string;
  description?: string;
  serverId: string;
  serverName: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  browser: 'bg-accent-muted text-accent border-accent/30',
  productivity: 'bg-warning/20 text-warning border-warning/30',
  filesystem: 'bg-success/20 text-success border-success/30',
  search: 'bg-accent-muted text-accent border-accent/30',
  dev: 'bg-warning/20 text-warning border-warning/30',
  ai: 'bg-accent-muted text-accent border-accent/30',
  database: 'bg-success/20 text-success border-success/30',
  utility: 'bg-surface-active text-text-secondary border-border',
  official: 'bg-warning/20 text-warning border-warning/30',
};

export const SettingsMCPMarketplace: React.FC = () => {
  const { t } = useTranslation();
  const [items, setItems] = useState<MCPMarketplaceItem[]>([]);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [envInputs, setEnvInputs] = useState<Record<string, Record<string, string>>>({});
  const [serverTools, setServerTools] = useState<Record<string, MCPToolSummary[]>>({});
  const [subTab, setSubTab] = useState<'marketplace' | 'playground'>('marketplace');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const api = window.electronAPI;
      if (!api?.mcp?.registry) {
        setItems([]);
        return;
      }
      const result = (await api.mcp.registry()) as unknown as MCPMarketplaceItem[];
      setItems(result);
    } catch (err) {
      console.error('[SettingsMCPMarketplace] load failed:', err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) set.add(item.category);
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    let result = items;
    if (categoryFilter) {
      result = result.filter((i) => i.category === categoryFilter);
    }
    if (query.trim()) {
      const lower = query.trim().toLowerCase();
      result = result.filter(
        (i) =>
          i.name.toLowerCase().includes(lower) ||
          i.description.toLowerCase().includes(lower) ||
          i.tags.some((t) => t.toLowerCase().includes(lower)) ||
          i.category.toLowerCase().includes(lower)
      );
    }
    return result;
  }, [items, query, categoryFilter]);

  const showNotice = useCallback((type: 'success' | 'error', message: string) => {
    setNotice({ type, message });
    setTimeout(() => setNotice(null), 4000);
  }, []);

  const handleInstall = useCallback(
    async (item: MCPMarketplaceItem) => {
      const api = window.electronAPI;
      if (!api?.mcp?.registryInstall) return;

      // Check required env vars
      const envOverrides = envInputs[item.id] ?? {};
      const missing = (item.requiresEnv ?? []).filter((key) => !envOverrides[key]?.trim());
      if (missing.length > 0) {
        setExpandedId(item.id);
        showNotice('error', `${t('mcpMarketplace.missingEnv')}: ${missing.join(', ')}`);
        return;
      }

      setBusyId(item.id);
      try {
        const result = await api.mcp.registryInstall(item.id, envOverrides);
        if (result.success) {
          showNotice('success', t('mcpMarketplace.installed', { name: item.name }));
          await load();
        } else {
          showNotice('error', result.error ?? 'Install failed');
        }
      } finally {
        setBusyId(null);
      }
    },
    [envInputs, load, showNotice, t]
  );

  const handleUninstall = useCallback(
    async (item: MCPMarketplaceItem) => {
      if (!confirm(t('mcpMarketplace.uninstallConfirm', { name: item.name }))) return;
      const api = window.electronAPI;
      if (!api?.mcp?.registryUninstall) return;
      setBusyId(item.id);
      try {
        const result = await api.mcp.registryUninstall(item.id);
        if (result.success) {
          showNotice('success', t('mcpMarketplace.uninstalled', { name: item.name }));
          await load();
        } else {
          showNotice('error', result.error ?? 'Uninstall failed');
        }
      } finally {
        setBusyId(null);
      }
    },
    [load, showNotice, t]
  );

  const handleToggleEnabled = useCallback(
    async (item: MCPMarketplaceItem) => {
      const api = window.electronAPI;
      if (!api?.mcp?.registrySetEnabled) return;
      setBusyId(item.id);
      try {
        const result = await api.mcp.registrySetEnabled(item.id, !item.enabled);
        if (result.success) {
          await load();
        } else {
          showNotice('error', result.error ?? 'Toggle failed');
        }
      } finally {
        setBusyId(null);
      }
    },
    [load, showNotice]
  );

  const handleExpand = useCallback(async (item: MCPMarketplaceItem) => {
    const nextId = expandedId === item.id ? null : item.id;
    setExpandedId(nextId);
    if (nextId && item.installed && !serverTools[item.id]) {
      const api = window.electronAPI;
      if (api?.mcp?.registryTools) {
        try {
          const tools = await api.mcp.registryTools(item.id);
          setServerTools((prev) => ({ ...prev, [item.id]: tools }));
        } catch (err) {
          console.error('[SettingsMCPMarketplace] tools load failed:', err);
        }
      }
    }
  }, [expandedId, serverTools]);

  const handleEnvChange = useCallback((id: string, key: string, value: string) => {
    setEnvInputs((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? {}), [key]: value },
    }));
  }, []);

  return (
    <div className="flex flex-col h-full" data-testid="settings-mcp-marketplace">
      <div className="px-4 py-3 border-b border-border-muted">
        <div className="flex items-center gap-2 mb-3">
          <Wrench size={14} className="text-accent" />
          <h2 className="text-sm font-semibold text-text-primary">
            {t('mcpMarketplace.title')}
          </h2>
          <span className="ml-auto text-[11px] text-text-muted">
            {filtered.length} / {items.length}
          </span>
        </div>

        {/* Phase 3 step 7: sub-tabs */}
        <div className="flex gap-1 mb-2">
          <button
            onClick={() => setSubTab('marketplace')}
            data-testid="mcp-marketplace-tab"
            className={`text-xs px-3 py-1 rounded transition-colors ${
              subTab === 'marketplace'
                ? 'bg-accent/20 text-accent'
                : 'bg-surface text-text-muted hover:text-text-primary'
            }`}
          >
            {t('mcpMarketplace.tabMarketplace')}
          </button>
          <button
            onClick={() => setSubTab('playground')}
            data-testid="mcp-playground-tab"
            className={`text-xs px-3 py-1 rounded transition-colors ${
              subTab === 'playground'
                ? 'bg-accent/20 text-accent'
                : 'bg-surface text-text-muted hover:text-text-primary'
            }`}
          >
            {t('mcpMarketplace.tabPlayground')}
          </button>
        </div>

        {subTab === 'marketplace' && (
        <>
        <div className="relative mb-2">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="mcp-marketplace-search"
            placeholder={t('mcpMarketplace.search')}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-surface border border-border rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>

        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setCategoryFilter(null)}
            className={`text-[10px] px-2 py-0.5 rounded border ${
              categoryFilter === null
                ? 'bg-accent-muted border-accent text-accent'
                : 'bg-surface border-border text-text-secondary hover:text-text-primary'
            }`}
          >
            {t('mcpMarketplace.all')} ({items.length})
          </button>
          {categories.map((cat) => {
            const count = items.filter((i) => i.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`text-[10px] px-2 py-0.5 rounded border capitalize ${
                  categoryFilter === cat
                    ? (CATEGORY_COLORS[cat] ?? 'bg-accent-muted border-accent text-accent')
                    : 'bg-surface border-border text-text-secondary hover:text-text-primary'
                }`}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>
        </>
        )}
      </div>

      {subTab === 'playground' && (
        <div className="flex-1 overflow-y-auto p-4">
          <SettingsMCPPlayground />
        </div>
      )}

      {subTab === 'marketplace' && notice && (
        <div
          className={`mx-4 mt-3 p-2 rounded border text-xs flex items-start gap-2 ${
            notice.type === 'success'
              ? 'bg-success/10 border-success/30 text-success'
              : 'bg-error/10 border-error/30 text-error'
          }`}
        >
          {notice.type === 'success' ? (
            <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
          ) : (
            <XCircle size={14} className="shrink-0 mt-0.5" />
          )}
          <span className="flex-1">{notice.message}</span>
        </div>
      )}

      {subTab === 'marketplace' && (
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-text-muted">
            <Loader2 size={12} className="animate-spin" />
            {t('common.loading')}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-xs text-text-muted text-center py-6">
            {t('mcpMarketplace.noResults')}
          </div>
        )}

        {!loading &&
          filtered.map((item) => {
            const isExpanded = expandedId === item.id;
            const isBusy = busyId === item.id;
            return (
              <div
                key={item.id}
                data-testid={`mcp-marketplace-item-${item.id}`}
                className="rounded-lg border border-border-muted bg-surface/40 overflow-hidden"
              >
                <div
                  className="flex items-start gap-3 p-3 cursor-pointer hover:bg-surface-hover transition-colors"
                  onClick={() => void handleExpand(item)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-xs font-semibold text-text-primary truncate">
                        {item.name}
                      </h3>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded border ${
                          CATEGORY_COLORS[item.category] ??
                          'bg-surface-active text-text-secondary border-border'
                        }`}
                      >
                        {item.category}
                      </span>
                      {item.installed && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-success/20 text-success border border-success/30">
                          {item.enabled ? t('mcpMarketplace.active') : t('mcpMarketplace.disabled')}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-text-secondary line-clamp-2">
                      {item.description}
                    </p>
                    {item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {item.tags.slice(0, 5).map((tag) => (
                          <span
                            key={tag}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-surface text-text-muted"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div
                    className="flex items-center gap-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {item.installed ? (
                      <>
                        <button
                          onClick={() => void handleToggleEnabled(item)}
                          disabled={isBusy}
                          className={`p-1.5 rounded hover:bg-surface-hover ${
                            item.enabled ? 'text-success' : 'text-text-muted'
                          } disabled:opacity-50`}
                          title={
                            item.enabled
                              ? t('mcpMarketplace.disable')
                              : t('mcpMarketplace.enable')
                          }
                        >
                          <Power size={14} />
                        </button>
                        <button
                          onClick={() => void handleUninstall(item)}
                          disabled={isBusy}
                          className="p-1.5 rounded text-text-muted hover:text-error hover:bg-surface-hover disabled:opacity-50"
                          title={t('mcpMarketplace.uninstall')}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => void handleInstall(item)}
                        disabled={isBusy}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-accent hover:bg-accent-hover text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isBusy ? (
                          <Loader2 size={10} className="animate-spin" />
                        ) : (
                          <Download size={10} />
                        )}
                        {t('mcpMarketplace.install')}
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-border-muted bg-background/40">
                    <div className="pt-3 space-y-3">
                      {item.publisher && (
                        <div className="flex items-center gap-2 text-[11px] text-text-muted">
                          <span>{t('mcpMarketplace.publisher')}:</span>
                          <span className="text-text-secondary">{item.publisher}</span>
                          {item.homepage && (
                            <button
                              onClick={() =>
                                item.homepage &&
                                window.electronAPI?.openExternal(item.homepage)
                              }
                              className="ml-auto flex items-center gap-1 text-accent hover:text-accent-hover"
                            >
                              <ExternalLink size={10} />
                              {t('mcpMarketplace.homepage')}
                            </button>
                          )}
                        </div>
                      )}

                      {/* Command preview */}
                      {item.command && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
                            {t('mcpMarketplace.command')}
                          </div>
                          <pre className="text-[11px] font-mono bg-surface rounded p-2 text-text-secondary overflow-x-auto">
                            {item.command} {(item.args ?? []).join(' ')}
                          </pre>
                        </div>
                      )}

                      {/* Required env vars */}
                      {item.requiresEnv && item.requiresEnv.length > 0 && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
                            {t('mcpMarketplace.envVars')}
                          </div>
                          <div className="space-y-2">
                            {item.requiresEnv.map((key) => (
                              <div key={key}>
                                <label className="text-[11px] text-text-secondary font-mono">
                                  {key}
                                </label>
                                {item.envDescription?.[key] && (
                                  <p className="text-[10px] text-text-muted mb-1">
                                    {item.envDescription[key]}
                                  </p>
                                )}
                                {!item.installed && (
                                  <input
                                    type="password"
                                    value={envInputs[item.id]?.[key] ?? ''}
                                    onChange={(e) =>
                                      handleEnvChange(item.id, key, e.target.value)
                                    }
                                    placeholder={`Enter ${key}`}
                                    className="w-full px-2 py-1 text-xs bg-surface border border-border rounded text-text-primary focus:outline-none focus:border-accent"
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Tools (only if installed) */}
                      {item.installed && serverTools[item.id] && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
                            {t('mcpMarketplace.tools')} ({serverTools[item.id].length})
                          </div>
                          <div className="space-y-1 max-h-48 overflow-y-auto">
                            {serverTools[item.id].map((tool) => (
                              <div
                                key={tool.name}
                                className="p-2 rounded bg-surface/50 border border-border-muted"
                              >
                                <div className="text-[11px] font-mono text-text-primary">
                                  {tool.name}
                                </div>
                                {tool.description && (
                                  <div className="text-[10px] text-text-muted mt-0.5">
                                    {tool.description}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
      </div>
      )}
    </div>
  );
};
