import { useState, useEffect, useCallback } from 'react';
import { Zap, CheckCircle, XCircle, Loader2, RefreshCw, Globe } from 'lucide-react';

interface CodeBuddyConfig {
  enabled: boolean;
  endpoint: string;
  apiKey: string;
  model: string;
  /**
   * Activate Gemini's native server-side Google Search grounding when
   * the active model is Gemini. Persisted in the codebuddy.* config
   * branch and hot-applied via IPC after save.
   */
  geminiGroundingEnabled: boolean;
}

interface HealthStatus {
  status: 'unknown' | 'starting' | 'connected' | 'error';
  version?: string;
  models?: string[];
  tools?: number;
  message?: string;
}

interface ConnectionProbeSuccess {
  version: string;
  models: string[];
  tools: number;
}

function parseLocalServerEndpoint(endpoint: string): { host: string; port: number } | null {
  try {
    const url = new URL(endpoint);
    const hostname = url.hostname.toLowerCase();
    if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) return null;
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return {
      host: hostname === '::1' ? '::1' : '127.0.0.1',
      port,
    };
  } catch {
    return null;
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

export function SettingsCodeBuddy() {
  const [config, setConfig] = useState<CodeBuddyConfig>({
    enabled: false,
    endpoint: 'http://localhost:3000',
    apiKey: '',
    model: '',
    geminiGroundingEnabled: false,
  });
  const [health, setHealth] = useState<HealthStatus>({ status: 'unknown' });
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  // Load config on mount
  useEffect(() => {
    window.electronAPI?.config.get().then((appConfig) => {
      const cb = (appConfig as unknown as { codebuddy?: Partial<CodeBuddyConfig> })?.codebuddy;
      if (cb) {
        setConfig({
          enabled: cb.enabled ?? false,
          endpoint: cb.endpoint || 'http://localhost:3000',
          apiKey: cb.apiKey || '',
          model: cb.model || '',
          geminiGroundingEnabled: cb.geminiGroundingEnabled ?? false,
        });
      }
    }).catch(() => {});
  }, []);

  const probeConnection = useCallback(async (): Promise<ConnectionProbeSuccess> => {
    const res = await fetch(`${config.endpoint}/api/health`, {
      signal: AbortSignal.timeout(5000),
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    let models: string[] = [];
    let tools = 0;
    try {
      const modelsRes = await fetch(`${config.endpoint}/v1/models`, {
        headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      });
      if (modelsRes.ok) {
        const modelsData = await modelsRes.json();
        models = modelsData.data?.map((m: { id: string }) => m.id) || [];
      }
    } catch { /* optional */ }
    try {
      const metricsRes = await fetch(`${config.endpoint}/api/metrics`, {
        headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      });
      if (metricsRes.ok) {
        const metricsData = await metricsRes.json();
        tools = metricsData.toolCount || metricsData.tools || 0;
      }
    } catch { /* optional */ }

    return {
      version: data.version || 'unknown',
      models,
      tools,
    };
  }, [config.endpoint, config.apiKey]);

  const probeAfterStart = useCallback(async (): Promise<ConnectionProbeSuccess> => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        return await probeConnection();
      } catch (err) {
        lastError = err;
        await wait(500);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Code Buddy server did not become reachable.');
  }, [probeConnection]);

  const testConnection = useCallback(async () => {
    setIsTesting(true);
    setHealth({ status: 'unknown' });
    try {
      const connected = await probeConnection();
      setHealth({
        status: 'connected',
        version: connected.version,
        models: connected.models,
        tools: connected.tools,
      });
    } catch (initialErr) {
      const localEndpoint = parseLocalServerEndpoint(config.endpoint);
      const serverApi = window.electronAPI?.server;
      if (!localEndpoint || !serverApi?.start) {
        setHealth({
          status: 'error',
          message: initialErr instanceof Error ? initialErr.message : 'Connection failed',
        });
        setIsTesting(false);
        return;
      }

      setHealth({
        status: 'starting',
        message: 'Code Buddy is not responding; starting the local backend...',
      });

      const started = await serverApi.start({
        host: localEndpoint.host,
        port: localEndpoint.port,
      });
      if (!started.running) {
        setHealth({
          status: 'error',
          message: started.error || 'Code Buddy backend failed to start.',
        });
        setIsTesting(false);
        return;
      }

      try {
        const connected = await probeAfterStart();
        setHealth({
          status: 'connected',
          version: connected.version,
          models: connected.models,
          tools: connected.tools,
          message: 'Started local Code Buddy backend automatically.',
        });
      } catch (err) {
        setHealth({
          status: 'error',
          message: err instanceof Error ? err.message : 'Connection failed',
        });
      }
    } finally {
      setIsTesting(false);
    }
  }, [config.endpoint, probeConnection, probeAfterStart]);

  const saveConfig = useCallback(async () => {
    setIsSaving(true);
    setSavedMsg('');
    try {
      const currentConfig = await window.electronAPI?.config.get();
      const base = (currentConfig ?? {}) as unknown as Record<string, unknown>;
      await window.electronAPI?.config.save({
        ...base,
        codebuddy: {
          enabled: config.enabled,
          endpoint: config.endpoint,
          apiKey: config.apiKey || undefined,
          model: config.model || undefined,
          geminiGroundingEnabled: config.geminiGroundingEnabled,
        },
      } as Parameters<NonNullable<typeof window.electronAPI>['config']['save']>[0]);

      // Hot-apply grounding to the live engine adapter so the user
      // doesn't need to restart Cowork to see the toggle take effect
      // on the next turn. Failures here are non-fatal — the toggle is
      // already persisted to config and will apply at next boot.
      try {
        await window.electronAPI?.codebuddy?.setGeminiGrounding?.({
          enabled: config.geminiGroundingEnabled,
        });
      } catch {
        /* hot-apply best-effort; persisted setting is the source of truth */
      }

      setSavedMsg('Configuration saved!');
      setTimeout(() => setSavedMsg(''), 3000);
    } catch (err) {
      setSavedMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSaving(false);
    }
  }, [config]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
          <Zap className="w-5 h-5 text-accent" />
          Code Buddy Backend
        </h3>
        <p className="text-sm text-text-muted mt-1">
          Connect to a Code Buddy server for 110+ tools, MCTSr reasoning, multi-agent orchestration,
          and TurboQuant local inference.
        </p>
      </div>

      {/* Enable toggle */}
      <div className="flex items-center justify-between p-4 rounded-lg bg-surface-secondary border border-border-muted">
        <div>
          <p className="text-sm font-medium text-text-primary">Enable Code Buddy Backend</p>
          <p className="text-xs text-text-muted mt-0.5">
            Route LLM calls through Code Buddy instead of direct API
          </p>
        </div>
        <button
          onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            config.enabled ? 'bg-accent' : 'bg-gray-400'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
              config.enabled ? 'translate-x-5' : ''
            }`}
          />
        </button>
      </div>

      {/* Connection settings */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1.5">
            Server Endpoint
          </label>
          <input
            type="url"
            value={config.endpoint}
            onChange={e => setConfig(c => ({ ...c, endpoint: e.target.value }))}
            placeholder="http://localhost:3000"
            className="w-full px-3 py-2 rounded-lg bg-background border border-border-muted text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          <p className="text-xs text-text-muted mt-1">
            Start Code Buddy with: <code className="bg-surface-secondary px-1 rounded">buddy server</code>
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-1.5">
            API Key <span className="text-text-muted">(optional)</span>
          </label>
          <input
            type="password"
            value={config.apiKey}
            onChange={e => setConfig(c => ({ ...c, apiKey: e.target.value }))}
            placeholder="Leave empty for local server"
            className="w-full px-3 py-2 rounded-lg bg-background border border-border-muted text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-1.5">
            Model Override <span className="text-text-muted">(optional)</span>
          </label>
          <input
            type="text"
            value={config.model}
            onChange={e => setConfig(c => ({ ...c, model: e.target.value }))}
            placeholder="Uses server default (e.g. gemini-3.1-flash-lite-preview)"
            className="w-full px-3 py-2 rounded-lg bg-background border border-border-muted text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>
      </div>

      {/* Advanced: provider-specific feature flags. Only relevant when
          the Code Buddy backend is enabled — hidden otherwise to keep
          the panel focused on connection setup. */}
      {config.enabled && (
        <div className="space-y-3 pt-3 border-t border-border-muted">
          <h4 className="text-sm font-medium text-text-primary flex items-center gap-2">
            <Globe className="w-4 h-4 text-accent" />
            Advanced
          </h4>
          <div className="flex items-center justify-between p-4 rounded-lg bg-surface-secondary border border-border-muted">
            <div className="flex-1 min-w-0 mr-4">
              <p className="text-sm font-medium text-text-primary">
                Gemini Google Search grounding
              </p>
              <p className="text-xs text-text-muted mt-0.5">
                When the active model is a Gemini family member, let it search
                the web server-side and append cited sources to its replies.
                Ignored for non-Gemini models — safe to leave on.
              </p>
            </div>
            <button
              onClick={() => setConfig(c => ({ ...c, geminiGroundingEnabled: !c.geminiGroundingEnabled }))}
              className={`shrink-0 relative w-11 h-6 rounded-full transition-colors ${
                config.geminiGroundingEnabled ? 'bg-accent' : 'bg-gray-400'
              }`}
              aria-label="Toggle Gemini Google Search grounding"
              role="switch"
              aria-checked={config.geminiGroundingEnabled}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  config.geminiGroundingEnabled ? 'translate-x-5' : ''
                }`}
              />
            </button>
          </div>
        </div>
      )}

      {/* Test connection */}
      <div className="flex gap-3">
        <button
          onClick={testConnection}
          disabled={isTesting}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-secondary border border-border-muted text-text-primary text-sm hover:bg-surface-hover transition-colors disabled:opacity-50"
        >
          {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Test Connection
        </button>
        <button
          onClick={saveConfig}
          disabled={isSaving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-sm hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Save
        </button>
        {savedMsg && (
          <span className={`self-center text-sm ${savedMsg.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
            {savedMsg}
          </span>
        )}
      </div>

      {/* Connection status */}
      {health.status !== 'unknown' && (
        <div className={`p-4 rounded-lg border ${
          health.status === 'connected'
            ? 'bg-green-500/10 border-green-500/30'
            : health.status === 'starting'
              ? 'bg-accent/10 border-accent/30'
            : 'bg-red-500/10 border-red-500/30'
        }`}>
          <div className="flex items-center gap-2 mb-2">
            {health.status === 'connected'
              ? <CheckCircle className="w-5 h-5 text-green-400" />
              : health.status === 'starting'
                ? <Loader2 className="w-5 h-5 text-accent animate-spin" />
              : <XCircle className="w-5 h-5 text-red-400" />
            }
            <span className="font-medium text-sm text-text-primary">
              {health.status === 'connected'
                ? 'Connected to Code Buddy'
                : health.status === 'starting'
                  ? 'Starting Code Buddy'
                  : 'Connection Failed'}
            </span>
          </div>
          {health.status === 'connected' && (
            <div className="text-xs text-text-muted space-y-1 ml-7">
              {health.version && <p>Version: {health.version}</p>}
              {health.tools ? <p>Tools: {health.tools} available</p> : null}
              {health.models && health.models.length > 0 && (
                <p>Models: {health.models.slice(0, 5).join(', ')}{health.models.length > 5 ? ` +${health.models.length - 5} more` : ''}</p>
              )}
            </div>
          )}
          {health.status === 'starting' && health.message && (
            <p className="text-xs text-text-muted ml-7">{health.message}</p>
          )}
          {health.status === 'connected' && health.message && (
            <p className="text-xs text-green-400 ml-7">{health.message}</p>
          )}
          {health.status === 'error' && health.message && (
            <p className="text-xs text-red-400 ml-7">{health.message}</p>
          )}
        </div>
      )}

      {/* Features info */}
      {config.enabled && (
        <div className="p-4 rounded-lg bg-accent/5 border border-accent/20">
          <p className="text-sm font-medium text-text-primary mb-2">When enabled, you get:</p>
          <ul className="text-xs text-text-muted space-y-1">
            <li>• 110+ tools (file ops, search, git, web, code analysis, documents)</li>
            <li>• MCTSr reasoning (Tree-of-Thought + Monte Carlo search)</li>
            <li>• 15 LLM providers (Gemini, Claude, GPT, Grok, Ollama, vLLM...)</li>
            <li>• Multi-agent orchestration (spawn, send, wait, close, resume)</li>
            <li>• TurboQuant local inference (4-8x KV cache compression)</li>
            <li>• Document generation (PPTX, DOCX, XLSX, PDF) — native TypeScript</li>
            <li>• GUI automation (screenshot, click, type, key combos)</li>
          </ul>
        </div>
      )}
    </div>
  );
}
