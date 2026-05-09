import { useState, useEffect } from 'react';
import {
  X,
  Settings,
  Plug,
  Shield,
  Package,
  Clock3,
  Wifi,
  AlertCircle,
  Globe,
  ChevronRight,
  Zap,
  Workflow,
  DollarSign,
  Lock,
  FileText,
  SlashSquare,
  Layers,
  Webhook,
  Network,
  FolderKanban,
  Blocks,
  ServerCog,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWindowSize } from '../hooks/useWindowSize';
import { RemoteControlPanel } from './RemoteControlPanel';
import { useAppStore } from '../store';
import { SettingsAPI } from './settings/SettingsAPI';
import { SettingsSandbox } from './settings/SettingsSandbox';
import { SettingsConnectors } from './settings/SettingsConnectors';
import { SettingsSkills } from './settings/SettingsSkills';
import { SettingsSchedule } from './settings/SettingsSchedule';
import { SettingsGeneral } from './settings/SettingsGeneral';
import { SettingsLogs } from './settings/SettingsLogs';
import { SettingsCodeBuddy } from './settings/SettingsCodeBuddy';
import { SettingsWorkflows } from './settings/SettingsWorkflows';
import { SettingsCostDashboard } from './settings/SettingsCostDashboard';
import { SettingsPermissionRules } from './settings/SettingsPermissionRules';
import { SettingsMCPMarketplace } from './settings/SettingsMCPMarketplace';
import { SettingsSnippets } from './settings/SettingsSnippets';
import { SettingsCustomCommands } from './settings/SettingsCustomCommands';
import { SettingsWorkspacePresets } from './settings/SettingsWorkspacePresets';
import { SettingsHooks } from './settings/SettingsHooks';
import { SettingsA2AAgents } from './settings/SettingsA2AAgents';
import { SettingsServer } from './settings/SettingsServer';
import { SettingsCustomize } from './settings/SettingsCustomize';
import { SettingsProjects } from './settings/SettingsProjects';

interface SettingsPanelProps {
  onClose: () => void;
  initialTab?:
    | 'api'
    | 'sandbox'
    | 'connectors'
    | 'skills'
    | 'customize'
    | 'projects'
    | 'schedule'
    | 'remote'
    | 'logs'
    | 'codebuddy'
    | 'workflows'
    | 'cost'
    | 'rules'
    | 'mcpMarketplace'
    | 'snippets'
    | 'customCommands'
    | 'workspacePresets'
    | 'hooks'
    | 'a2a'
    | 'general';
}

type TabId =
  | 'api'
  | 'codebuddy'
  | 'sandbox'
  | 'connectors'
  | 'skills'
  | 'customize'
  | 'projects'
  | 'schedule'
  | 'remote'
  | 'logs'
  | 'workflows'
  | 'cost'
  | 'rules'
  | 'mcpMarketplace'
  | 'snippets'
  | 'customCommands'
  | 'workspacePresets'
  | 'hooks'
  | 'a2a'
  | 'server'
  | 'general';

const VALID_TABS = new Set<TabId>([
  'api',
  'codebuddy',
  'sandbox',
  'connectors',
  'skills',
  'customize',
  'projects',
  'schedule',
  'remote',
  'logs',
  'workflows',
  'cost',
  'rules',
  'mcpMarketplace',
  'snippets',
  'customCommands',
  'workspacePresets',
  'hooks',
  'a2a',
  'server',
  'general',
]);

export function SettingsPanel({ onClose, initialTab = 'api' }: SettingsPanelProps) {
  const { t } = useTranslation();
  const { width } = useWindowSize();
  const compactSidebar = width < 900;
  // Read settingsTab from store at mount time so external navigation (nav-server)
  // takes effect even before this component mounts.
  const storeTab = useAppStore((s) => s.settingsTab);
  const setSettingsTab = useAppStore((s) => s.setSettingsTab);
  const resolvedInitial =
    storeTab && VALID_TABS.has(storeTab as TabId) ? (storeTab as TabId) : initialTab;

  const [activeTab, setActiveTab] = useState<TabId>(resolvedInitial);
  // Track which tabs have been viewed at least once (for lazy loading)
  const [viewedTabs, setViewedTabs] = useState<Set<TabId>>(new Set([resolvedInitial]));
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    try {
      const v = window.electronAPI?.getVersion?.();
      if (v instanceof Promise) v.then(setAppVersion);
      else if (v) setAppVersion(v);
    } catch {
      /* ignore */
    }
  }, []);

  // Consume the store signal and apply tab in one effect
  useEffect(() => {
    if (storeTab && VALID_TABS.has(storeTab as TabId)) {
      setActiveTab(storeTab as TabId);
      setSettingsTab(null);
    }
  }, [storeTab, setSettingsTab]);

  // Mark tab as viewed when it becomes active
  useEffect(() => {
    if (!viewedTabs.has(activeTab)) {
      setViewedTabs((prev) => new Set([...prev, activeTab]));
    }
  }, [activeTab]);

  const tabs = [
    {
      id: 'api' as TabId,
      label: t('settings.apiSettings'),
      icon: Settings,
      description: t('settings.apiSettingsDesc'),
    },
    {
      id: 'codebuddy' as TabId,
      label: 'Code Buddy',
      icon: Zap,
      description: 'Local agentic backend with 110+ tools',
    },
    {
      id: 'sandbox' as TabId,
      label: t('settings.sandbox'),
      icon: Shield,
      description: t('settings.sandboxDesc'),
    },
    {
      id: 'connectors' as TabId,
      label: t('settings.connectors'),
      icon: Plug,
      description: t('settings.connectorsDesc'),
    },
    {
      id: 'skills' as TabId,
      label: t('settings.skills'),
      icon: Package,
      description: t('settings.skillsDesc'),
    },
    {
      id: 'customize' as TabId,
      label: t('settings.customize', 'Customize'),
      icon: Blocks,
      description: t('settings.customizeDesc', 'Plugins, connectors, workflows, hooks, and reusable workspace behavior'),
    },
    {
      id: 'projects' as TabId,
      label: t('settings.projects', 'Projects'),
      icon: FolderKanban,
      description: t('settings.projectsDesc', 'Workspace profiles with project-scoped memory'),
    },
    {
      id: 'schedule' as TabId,
      label: t('settings.schedule'),
      icon: Clock3,
      description: t('settings.scheduleDesc'),
    },
    {
      id: 'remote' as TabId,
      label: t('settings.remote', '远程控制'),
      icon: Wifi,
      description: t('settings.remoteDesc', '通过飞书等平台远程使用'),
    },
    {
      id: 'logs' as TabId,
      label: t('settings.logs'),
      icon: AlertCircle,
      description: t('settings.logsDesc'),
    },
    {
      id: 'workflows' as TabId,
      label: t('settings.workflows', 'Workflows'),
      icon: Workflow,
      description: t('settings.workflowsDesc', 'Visual DAG editor for repeatable workflows'),
    },
    {
      id: 'cost' as TabId,
      label: t('settings.cost', 'Cost'),
      icon: DollarSign,
      description: t('settings.costDesc', 'Token usage, cost tracking, and budget limits'),
    },
    {
      id: 'rules' as TabId,
      label: t('settings.rules', 'Permission rules'),
      icon: Lock,
      description: t('settings.rulesDesc', 'Allow/deny rules for tools and file paths'),
    },
    {
      id: 'mcpMarketplace' as TabId,
      label: t('settings.mcpMarketplace', 'MCP marketplace'),
      icon: Plug,
      description: t('settings.mcpMarketplaceDesc', 'Install MCP servers from the registry'),
    },
    {
      id: 'snippets' as TabId,
      label: t('snippets.title', 'Snippets'),
      icon: FileText,
      description: t('snippets.settingsHint', 'Reusable prompt templates'),
    },
    {
      id: 'customCommands' as TabId,
      label: t('customCommands.title', 'Custom commands'),
      icon: SlashSquare,
      description: t('customCommands.hint', 'User-defined slash commands'),
    },
    {
      id: 'workspacePresets' as TabId,
      label: t('workspacePresets.title', 'Workspace presets'),
      icon: Layers,
      description: t('workspacePresets.hint', 'Save and apply workspace configurations'),
    },
    {
      id: 'hooks' as TabId,
      label: t('hooks.title', 'Hooks & triggers'),
      icon: Webhook,
      description: t('hooks.hint', 'Run shell or HTTP hooks on agent events'),
    },
    {
      id: 'a2a' as TabId,
      label: t('a2a.title', 'Remote agents (A2A)'),
      icon: Network,
      description: t('a2a.hint', 'Register and invoke remote A2A agents'),
    },
    {
      id: 'server' as TabId,
      label: t('settingsServer.title', 'Embedded server'),
      icon: ServerCog,
      description: t('settingsServer.hintShort', 'Configure port, JWT, websocket'),
    },
    {
      id: 'general' as TabId,
      label: t('settings.general'),
      icon: Globe,
      description: t('settings.generalDesc'),
    },
  ];
  const activeTabMeta = tabs.find((tab) => tab.id === activeTab);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background" data-testid="settings-panel">
      {/* Sidebar */}
      <div
        className={`${compactSidebar ? 'w-14' : 'w-52 lg:w-60'} bg-background-secondary/88 border-r border-border-muted flex flex-col flex-shrink-0`}
      >
        {!compactSidebar && (
          <div className="px-4 pt-5 pb-4 border-b border-border-muted">
            <p className="text-[11px] uppercase tracking-[0.16em] text-text-muted">
              {t('settings.title')}
            </p>
            <h2 className="mt-1 text-[1.24rem] font-semibold tracking-[-0.03em] text-text-primary">
              Code Buddy Cowork
            </h2>
            <p className="mt-1 text-[11px] leading-4 text-text-muted">{t('settings.panelDesc')}</p>
          </div>
        )}
        <div className={`flex-1 ${compactSidebar ? 'p-1.5 space-y-1' : 'p-3 space-y-1.5'}`}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              title={compactSidebar ? tab.label : undefined}
              data-testid={`settings-tab-${tab.id}`}
              className={`w-full flex items-center ${compactSidebar ? 'justify-center p-2.5' : 'gap-3 px-3.5 py-3'} rounded-lg text-left transition-colors active:scale-[0.98] ${
                activeTab === tab.id
                  ? 'bg-accent/10 text-text-primary font-medium border-l-2 border-accent'
                  : 'hover:bg-surface-hover text-text-secondary hover:text-text-primary'
              }`}
            >
              <tab.icon className="w-4.5 h-4.5 flex-shrink-0" />
              {!compactSidebar && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{tab.label}</p>
                  <p className="text-[11px] leading-4 text-text-muted line-clamp-2 mt-0.5">
                    {tab.description}
                  </p>
                </div>
              )}
              {!compactSidebar && activeTab === tab.id && (
                <ChevronRight className="w-4 h-4 flex-shrink-0" />
              )}
            </button>
          ))}
        </div>
        <div className={`${compactSidebar ? 'p-1.5' : 'p-4'} border-t border-border-muted`}>
          <button
            onClick={onClose}
            className={`w-full py-2 ${compactSidebar ? 'px-2' : 'px-4'} rounded-lg bg-background hover:bg-background transition-colors text-text-secondary text-sm`}
            title={compactSidebar ? t('common.close') : undefined}
          >
            {compactSidebar ? <X className="w-4 h-4 mx-auto" /> : t('common.close')}
          </button>
          {!compactSidebar && (
            <p className="text-[10px] text-text-muted text-center mt-2 select-text">
              v{appVersion}
            </p>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="flex items-center justify-between px-4 lg:px-8 py-4 border-b border-border-muted flex-shrink-0 bg-background/88 backdrop-blur-sm">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-text-muted">
              {t('settings.title')}
            </p>
            <h3 className="mt-1 text-[1.15rem] font-semibold tracking-[-0.02em] text-text-primary">
              {activeTabMeta?.label}
            </h3>
            {activeTabMeta?.description && (
              <p className="mt-1 text-sm text-text-muted max-w-[36rem]">
                {activeTabMeta.description}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-hover transition-colors"
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 lg:px-8 lg:py-8">
          <div className="max-w-[860px] w-full min-w-0 mx-auto">
            <div className="">
              <div className={activeTab === 'api' ? '' : 'hidden'}>
                {viewedTabs.has('api') && (
                  <>
                    <SettingsAPI />
                  </>
                )}
              </div>
              <div className={activeTab === 'codebuddy' ? '' : 'hidden'}>
                {viewedTabs.has('codebuddy') && <SettingsCodeBuddy />}
              </div>
              <div className={activeTab === 'sandbox' ? '' : 'hidden'}>
                {viewedTabs.has('sandbox') && <SettingsSandbox />}
              </div>
              <div className={activeTab === 'connectors' ? '' : 'hidden'}>
                {viewedTabs.has('connectors') && (
                  <SettingsConnectors isActive={activeTab === 'connectors'} />
                )}
              </div>
              <div className={activeTab === 'skills' ? '' : 'hidden'}>
                {viewedTabs.has('skills') && <SettingsSkills isActive={activeTab === 'skills'} />}
              </div>
              <div className={activeTab === 'customize' ? '' : 'hidden'}>
                {viewedTabs.has('customize') && (
                  <SettingsCustomize
                    onNavigate={(tab) => {
                      setActiveTab(tab);
                    }}
                  />
                )}
              </div>
              <div className={activeTab === 'projects' ? '' : 'hidden'}>
                {viewedTabs.has('projects') && <SettingsProjects />}
              </div>
              <div className={activeTab === 'schedule' ? '' : 'hidden'}>
                {viewedTabs.has('schedule') && (
                  <SettingsSchedule isActive={activeTab === 'schedule'} />
                )}
              </div>
              <div className={activeTab === 'remote' ? '' : 'hidden'}>
                {viewedTabs.has('remote') && (
                  <RemoteControlPanel isActive={activeTab === 'remote'} />
                )}
              </div>
              <div className={activeTab === 'logs' ? '' : 'hidden'}>
                {viewedTabs.has('logs') && <SettingsLogs isActive={activeTab === 'logs'} />}
              </div>
              <div className={activeTab === 'workflows' ? '' : 'hidden'}>
                {viewedTabs.has('workflows') && <SettingsWorkflows />}
              </div>
              <div className={activeTab === 'cost' ? '' : 'hidden'}>
                {viewedTabs.has('cost') && <SettingsCostDashboard />}
              </div>
              <div className={activeTab === 'rules' ? '' : 'hidden'}>
                {viewedTabs.has('rules') && <SettingsPermissionRules isActive={activeTab === 'rules'} />}
              </div>
              <div className={activeTab === 'mcpMarketplace' ? '' : 'hidden'}>
                {viewedTabs.has('mcpMarketplace') && <SettingsMCPMarketplace />}
              </div>
              <div className={activeTab === 'snippets' ? '' : 'hidden'}>
                {viewedTabs.has('snippets') && <SettingsSnippets />}
              </div>
              <div className={activeTab === 'customCommands' ? '' : 'hidden'}>
                {viewedTabs.has('customCommands') && <SettingsCustomCommands />}
              </div>
              <div className={activeTab === 'workspacePresets' ? '' : 'hidden'}>
                {viewedTabs.has('workspacePresets') && <SettingsWorkspacePresets />}
              </div>
              <div className={activeTab === 'hooks' ? '' : 'hidden'}>
                {viewedTabs.has('hooks') && <SettingsHooks />}
              </div>
              <div className={activeTab === 'a2a' ? '' : 'hidden'}>
                {viewedTabs.has('a2a') && <SettingsA2AAgents />}
              </div>
              <div className={activeTab === 'server' ? '' : 'hidden'}>
                {viewedTabs.has('server') && <SettingsServer />}
              </div>
              <div className={activeTab === 'general' ? '' : 'hidden'}>
                {viewedTabs.has('general') && <SettingsGeneral />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
