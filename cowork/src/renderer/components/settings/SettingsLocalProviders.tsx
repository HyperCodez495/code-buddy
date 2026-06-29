import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Cpu, Loader2, Plug, RefreshCw, Server } from 'lucide-react';
import type { ModelInventorySnapshot, ProviderModelInfo } from '../../types';
import { SettingsContentSection } from './shared';

type LocalProviderKey = 'ollama' | 'lmstudio';

interface LocalProviderState {
  status: 'idle' | 'loading' | 'ready' | 'empty' | 'unavailable';
  baseUrl: string;
  models: ProviderModelInfo[];
  machineLabel?: string;
  launchHint?: string;
  benchmarkScore?: number;
  error?: string;
}

interface SettingsLocalProvidersProps {
  onConnect: (provider: LocalProviderKey, payload: { baseUrl: string; models: ProviderModelInfo[] }) => void;
}

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

const DEFAULT_PROVIDER_STATE: Record<LocalProviderKey, LocalProviderState> = {
  ollama: {
    status: 'idle',
    baseUrl: 'http://localhost:11434/v1',
    models: [],
  },
  lmstudio: {
    status: 'idle',
    baseUrl: 'http://localhost:1234/v1',
    models: [],
  },
};

function normalizeModels(models?: string[]): ProviderModelInfo[] {
  return (models || [])
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => ({ id, name: id }));
}

function snapshotToModels(snapshot: ModelInventorySnapshot | null | undefined, provider: LocalProviderKey): LocalProviderState {
  const entries = snapshot?.entries.filter((entry) => entry.runtimeProvider === provider) ?? [];
  const models = entries.map((entry) => ({ id: entry.model, name: entry.model }));
  const first = entries[0];
  return {
    status: entries.length > 0 ? 'ready' : 'empty',
    baseUrl: first?.baseURL || (provider === 'ollama' ? 'http://localhost:11434/v1' : 'http://localhost:1234/v1'),
    models,
    machineLabel: first?.machineLabel,
    launchHint: first?.launchHint,
    benchmarkScore: first?.benchmarkScore,
  };
}

export function SettingsLocalProviders({ onConnect }: SettingsLocalProvidersProps) {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<Record<LocalProviderKey, LocalProviderState>>(DEFAULT_PROVIDER_STATE);

  const refreshProvider = useCallback(async (provider: LocalProviderKey) => {
    if (!isElectron) return;
    setProviders((current) => ({
      ...current,
      [provider]: { ...current[provider], status: 'loading', error: undefined },
    }));

    try {
      const snapshot = await window.electronAPI.config.modelInventory?.({ includeTailnetPeers: provider === 'ollama' });
      const nextState = snapshotToModels(snapshot, provider);
      setProviders((current) => ({
        ...current,
        [provider]: {
          ...current[provider],
          ...nextState,
          status: nextState.models.length > 0 ? 'ready' : 'empty',
        },
      }));
    } catch (error) {
      try {
        const result =
          provider === 'ollama'
            ? await window.electronAPI.config.discoverLocal()
            : await window.electronAPI.config.discoverLocalLmStudio();

        const models = normalizeModels(result.models);
        setProviders((current) => ({
          ...current,
          [provider]: {
            baseUrl: result.baseUrl,
            models,
            status: !result.available ? 'unavailable' : result.status === 'service_available' ? 'empty' : 'ready',
          },
        }));
      } catch (fallbackError) {
        setProviders((current) => ({
          ...current,
          [provider]: {
            ...current[provider],
            status: 'unavailable',
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          },
        }));
      }
    }
  }, []);

  useEffect(() => {
    if (!isElectron) return;
    void refreshProvider('ollama');
    void refreshProvider('lmstudio');
  }, [refreshProvider]);

  const cards: Array<{
    id: LocalProviderKey;
    title: string;
    hint: string;
  }> = [
    {
      id: 'ollama',
      title: 'Ollama',
      hint: t('api.localProviderOllamaHint', 'OpenAI-compatible local server on port 11434'),
    },
    {
      id: 'lmstudio',
      title: 'LM Studio',
      hint: t('api.localProviderLmStudioHint', 'OpenAI-compatible local server on port 1234'),
    },
  ];

  return (
    <SettingsContentSection
      title={t('api.localProvidersTitle', 'Local providers')}
      description={t(
        'api.localProvidersDesc',
        'Detect local model servers, inspect loaded models, and connect the current config to a local runtime in one click.'
      )}
    >
      <div className="grid gap-3 md:grid-cols-2">
        {cards.map((card) => {
          const state = providers[card.id];
          const isReady = state.status === 'ready' || state.status === 'empty';
          return (
            <div key={card.id} className="rounded-xl border border-border-muted bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <Server className="h-4 w-4 text-accent" />
                    {card.title}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-text-muted">{card.hint}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void refreshProvider(card.id)}
                  className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-hover"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${state.status === 'loading' ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="mt-3 space-y-2 text-xs text-text-secondary">
                <div className="flex items-center gap-2">
                  {state.status === 'loading' ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                      {t('common.loading')}
                    </>
                  ) : state.status === 'ready' ? (
                    <>
                      <CheckCircle className="h-3.5 w-3.5 text-success" />
                      {t('api.localProviderReady', { count: state.models.length })}
                    </>
                  ) : state.status === 'empty' ? (
                    <>
                      <Cpu className="h-3.5 w-3.5 text-warning" />
                      {t('api.localProviderEmpty', 'Server reachable, but no models are loaded')}
                    </>
                  ) : state.status === 'unavailable' ? (
                    <>
                      <Plug className="h-3.5 w-3.5 text-text-muted" />
                      {t('api.localProviderUnavailable', 'Server not reachable')}
                    </>
                  ) : (
                    <>
                      <Plug className="h-3.5 w-3.5 text-text-muted" />
                      {t('api.localProviderIdle', 'Detection pending')}
                    </>
                  )}
                </div>
                <div className="break-all">{state.baseUrl}</div>
                {state.machineLabel && (
                  <div className="text-[11px] text-text-muted">
                    {t('api.localProviderMachine', 'Machine')}: {state.machineLabel}
                  </div>
                )}
                {state.launchHint && (
                  <div className="text-[11px] text-text-muted">{state.launchHint}</div>
                )}
                {typeof state.benchmarkScore === 'number' && (
                  <div className="text-[11px] text-text-muted">
                    {t('api.localProviderBenchmark', 'Benchmark')}: {state.benchmarkScore.toFixed(0)}
                  </div>
                )}
                {state.models.length > 0 && (
                  <div className="rounded-lg bg-surface px-3 py-2 text-[11px] text-text-muted">
                    {state.models.slice(0, 4).map((model) => model.id).join(' • ')}
                    {state.models.length > 4 ? ` +${state.models.length - 4}` : ''}
                  </div>
                )}
                {state.error && <div className="text-error">{state.error}</div>}
              </div>

              <div className="mt-3">
                <button
                  type="button"
                  disabled={!isReady}
                  onClick={() => onConnect(card.id, { baseUrl: state.baseUrl, models: state.models })}
                  className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                >
                  {t('api.connectLocalProvider', 'Use this provider')}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </SettingsContentSection>
  );
}
