/**
 * SettingsPlugins — P2.4
 *
 * Lists installed plugins, lets the user enable/disable each one and toggle
 * individual components (skills, commands, agents, hooks, mcp). Browses the
 * catalog for new plugins to install.
 *
 * Reuses the existing `window.electronAPI.plugins.*` bridge.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Package,
  Power,
  Trash2,
  Download,
  RefreshCw,
  Search,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type {
  InstalledPlugin,
  PluginCatalogItemV2,
  PluginComponentKind,
} from '../../types';

type Tab = 'installed' | 'catalog';

const COMPONENT_KINDS: PluginComponentKind[] = ['skills', 'commands', 'agents', 'hooks', 'mcp'];

export function SettingsPlugins() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('installed');
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [catalog, setCatalog] = useState<PluginCatalogItemV2[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refreshInstalled = useCallback(async () => {
    const api = window.electronAPI?.plugins?.listInstalled;
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const list = await api();
      setInstalled(list ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshCatalog = useCallback(async () => {
    const api = window.electronAPI?.plugins?.listCatalog;
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const list = await api({ installableOnly: true });
      setCatalog(list ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshInstalled();
  }, [refreshInstalled]);

  useEffect(() => {
    if (tab === 'catalog') void refreshCatalog();
  }, [tab, refreshCatalog]);

  const handleToggle = async (plugin: InstalledPlugin) => {
    const api = window.electronAPI?.plugins?.setEnabled;
    if (!api) return;
    setBusyId(plugin.pluginId);
    try {
      await api(plugin.pluginId, !plugin.enabled);
      await refreshInstalled();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleComponentToggle = async (
    plugin: InstalledPlugin,
    component: PluginComponentKind
  ) => {
    const api = window.electronAPI?.plugins?.setComponentEnabled;
    if (!api) return;
    setBusyId(plugin.pluginId);
    try {
      const currentlyEnabled = plugin.componentsEnabled[component];
      await api(plugin.pluginId, component, !currentlyEnabled);
      await refreshInstalled();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleUninstall = async (plugin: InstalledPlugin) => {
    if (
      !window.confirm(
        t('plugins.confirmUninstall', `Uninstall plugin "${plugin.name}"?`, { name: plugin.name })
      )
    )
      return;
    const api = window.electronAPI?.plugins?.uninstall;
    if (!api) return;
    setBusyId(plugin.pluginId);
    try {
      await api(plugin.pluginId);
      await refreshInstalled();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleInstall = async (name: string) => {
    const api = window.electronAPI?.plugins?.install;
    if (!api) return;
    setBusyId(name);
    setError(null);
    try {
      await api(name);
      await refreshInstalled();
      setTab('installed');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const filteredInstalled = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return installed;
    return installed.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q) ||
        (p.authorName ?? '').toLowerCase().includes(q)
    );
  }, [installed, search]);

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q) ||
        (p.authorName ?? '').toLowerCase().includes(q)
    );
  }, [catalog, search]);

  return (
    <div className="p-4 space-y-4" data-testid="settings-plugins">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package size={16} className="text-text-muted" />
          <h3 className="text-sm font-semibold">{t('plugins.title', 'Plugins')}</h3>
        </div>
        <button
          type="button"
          onClick={() => (tab === 'installed' ? refreshInstalled() : refreshCatalog())}
          className="p-1.5 rounded-md hover:bg-surface-hover"
          title={t('common.refresh', 'Refresh')}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <p className="text-xs text-text-muted">
        {t(
          'plugins.intro',
          'Plugins extend Cowork with custom skills, slash commands, agents, lifecycle hooks, or MCP servers. Toggle individual components to keep what you need without uninstalling.'
        )}
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setTab('installed')}
          className={`px-3 py-1.5 text-xs rounded-md ${
            tab === 'installed' ? 'bg-accent/10 text-accent' : 'hover:bg-surface-hover text-text-secondary'
          }`}
          data-testid="plugins-tab-installed"
        >
          {t('plugins.installed', 'Installed')} ({installed.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('catalog')}
          className={`px-3 py-1.5 text-xs rounded-md ${
            tab === 'catalog' ? 'bg-accent/10 text-accent' : 'hover:bg-surface-hover text-text-secondary'
          }`}
          data-testid="plugins-tab-catalog"
        >
          {t('plugins.catalog', 'Marketplace')}
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('plugins.searchPlaceholder', 'Search plugins…')}
          className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-background border border-border-subtle focus:outline-none focus:border-accent"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-error/10 border border-error/30 text-error text-xs">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {tab === 'installed' && (
        <div className="space-y-2" data-testid="plugins-installed-list">
          {filteredInstalled.length === 0 && (
            <p className="text-xs italic text-text-muted text-center py-6">
              {t('plugins.empty', 'No plugins installed. Browse the marketplace to add some.')}
            </p>
          )}
          {filteredInstalled.map((plugin) => {
            const isExpanded = expandedId === plugin.pluginId;
            return (
              <div
                key={plugin.pluginId}
                className={`border rounded-lg overflow-hidden transition-colors ${
                  plugin.enabled ? 'border-border-subtle' : 'border-border-subtle opacity-60'
                }`}
              >
                <div className="flex items-start gap-2 p-3">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : plugin.pluginId)}
                    className="mt-0.5"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{plugin.name}</span>
                      {plugin.version && (
                        <span className="text-[10px] text-text-muted">v{plugin.version}</span>
                      )}
                    </div>
                    {plugin.description && (
                      <p className="text-[11px] text-text-muted line-clamp-2 mt-0.5">
                        {plugin.description}
                      </p>
                    )}
                    {plugin.authorName && (
                      <p className="text-[10px] text-text-muted mt-1">by {plugin.authorName}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggle(plugin)}
                      disabled={busyId === plugin.pluginId}
                      className={`p-1.5 rounded-md ${
                        plugin.enabled
                          ? 'text-success hover:bg-success/10'
                          : 'text-text-muted hover:bg-surface-hover'
                      }`}
                      title={
                        plugin.enabled
                          ? t('plugins.disable', 'Disable')
                          : t('plugins.enable', 'Enable')
                      }
                      data-testid={`plugin-toggle-${plugin.pluginId}`}
                    >
                      <Power size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUninstall(plugin)}
                      disabled={busyId === plugin.pluginId}
                      className="p-1.5 rounded-md text-text-muted hover:text-error hover:bg-error/10"
                      title={t('plugins.uninstall', 'Uninstall')}
                      data-testid={`plugin-uninstall-${plugin.pluginId}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-border-subtle bg-surface/30 space-y-2 pt-2">
                    <p className="text-[10px] uppercase tracking-wide text-text-muted">
                      {t('plugins.components', 'Components')}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {COMPONENT_KINDS.map((kind) => {
                        const count = plugin.componentCounts[kind] ?? 0;
                        const enabled = plugin.componentsEnabled[kind] ?? false;
                        if (count === 0) return null;
                        return (
                          <button
                            key={kind}
                            type="button"
                            onClick={() => handleComponentToggle(plugin, kind)}
                            disabled={busyId === plugin.pluginId}
                            className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs border transition-colors ${
                              enabled
                                ? 'border-accent/40 bg-accent/5 text-text-primary'
                                : 'border-border-subtle text-text-muted hover:bg-surface-hover'
                            }`}
                            data-testid={`plugin-${plugin.pluginId}-comp-${kind}`}
                          >
                            <span className="capitalize">{kind}</span>
                            <span className="text-[10px]">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-text-muted italic">
                      {t('plugins.sourcePath', 'Source')}: {plugin.sourcePath}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'catalog' && (
        <div className="space-y-2" data-testid="plugins-catalog-list">
          {filteredCatalog.length === 0 && !loading && (
            <p className="text-xs italic text-text-muted text-center py-6">
              {t('plugins.catalogEmpty', 'Marketplace is empty or unreachable.')}
            </p>
          )}
          {filteredCatalog.map((plugin) => {
            const alreadyInstalled = installed.some((p) => p.name === plugin.name);
            return (
              <div
                key={plugin.name}
                className="border border-border-subtle rounded-lg p-3 flex items-start gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{plugin.name}</span>
                    {plugin.version && (
                      <span className="text-[10px] text-text-muted">v{plugin.version}</span>
                    )}
                    {alreadyInstalled && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-success/10 text-success">
                        <CheckCircle2 size={10} />
                        {t('plugins.installed', 'Installed')}
                      </span>
                    )}
                  </div>
                  {plugin.description && (
                    <p className="text-[11px] text-text-muted line-clamp-2 mt-0.5">
                      {plugin.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleInstall(plugin.name)}
                  disabled={alreadyInstalled || busyId === plugin.name || !plugin.installable}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md bg-accent text-background disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent-hover"
                  data-testid={`plugin-install-${plugin.name}`}
                >
                  <Download size={12} />
                  {alreadyInstalled
                    ? t('plugins.installed', 'Installed')
                    : busyId === plugin.name
                      ? t('plugins.installing', 'Installing…')
                      : t('plugins.install', 'Install')}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
