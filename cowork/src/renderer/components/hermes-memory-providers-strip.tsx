import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  HardDrive,
  PlayCircle,
  Terminal,
} from 'lucide-react';

export type HermesMemoryProviderStatus = 'available' | 'configured' | 'fallback' | 'missing';

export interface HermesMemoryProviderReviewItem {
  active: boolean;
  baseUrlSources: string[];
  configured: boolean;
  credentialSources: string[];
  id: string;
  label: string;
  local: boolean;
  notes: string[];
  officialSurface: string;
  registered: boolean;
  remediation: string[];
  status: HermesMemoryProviderStatus;
}

export interface HermesMemoryProvidersReview {
  activeProviderId: string;
  command: string;
  configuredRemoteCount: number;
  fallbackCount: number;
  generatedAt: string;
  issues: string[];
  missingOfficialCount: number;
  ok: boolean;
  providers: HermesMemoryProviderReviewItem[];
  recommendations: string[];
  registeredCount: number;
}

export interface HermesMemoryProbeResult {
  activeProviderId: string;
  error?: string;
  fellBackToLocal: boolean;
  generatedAt: string;
  notes: string[];
  ok: boolean;
  providerId: string;
  remote: boolean;
  retrieved: boolean;
  retrievedSample?: string;
  verdict: 'pass' | 'pending' | 'fail';
  wrote: boolean;
}

interface HermesMemoryProvidersApi {
  get?: () => Promise<HermesMemoryProvidersReview | null>;
  probe?: (options: {
    providerId?: string;
  }) => Promise<{ error?: string; ok: boolean; result?: HermesMemoryProbeResult }>;
}

export const HermesMemoryProvidersStrip: React.FC<{
  error?: string | null;
  readiness?: HermesMemoryProvidersReview | null;
}> = ({ error = null, readiness }) => {
  const { t } = useTranslation();
  const [loadedReadiness, setLoadedReadiness] = useState<HermesMemoryProvidersReview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [probeErrors, setProbeErrors] = useState<Record<string, string>>({});
  const [probeResults, setProbeResults] = useState<Record<string, HermesMemoryProbeResult>>({});
  const [probingProviderId, setProbingProviderId] = useState<string | null>(null);
  const visibleReadiness = readiness ?? loadedReadiness;
  const visibleError = error ?? loadError;
  const command = useMemo(
    () => visibleReadiness?.command ?? 'buddy hermes memory status --json',
    [visibleReadiness?.command],
  );
  const statusClass = visibleReadiness?.ok
    ? 'border-success/40 bg-success/10 text-success'
    : 'border-warning/40 bg-warning/10 text-warning';
  const statusText = visibleReadiness?.ok
    ? t('fleet.hermesMemoryProviders.readyChip', 'memory ready')
    : t('fleet.hermesMemoryProviders.attentionChip', 'memory attention');

  useEffect(() => {
    if (readiness !== undefined) return;
    const api = getHermesMemoryProvidersApi();
    if (!api?.get) return;
    let cancelled = false;

    void api
      .get()
      .then((result) => {
        if (cancelled) return;
        setLoadedReadiness(result);
        setLoadError(null);
      })
      .catch((loadErrorValue: unknown) => {
        if (cancelled) return;
        setLoadedReadiness(null);
        setLoadError(loadErrorValue instanceof Error ? loadErrorValue.message : String(loadErrorValue));
      });

    return () => {
      cancelled = true;
    };
  }, [readiness]);

  const handleProbe = async (provider: HermesMemoryProviderReviewItem) => {
    const probe = getHermesMemoryProvidersApi()?.probe;
    if (!probe) {
      setProbeErrors((current) => ({
        ...current,
        [provider.id]: t('fleet.hermesMemoryProviders.probeUnavailable', 'Live probe is unavailable.'),
      }));
      return;
    }

    setProbingProviderId(provider.id);
    setProbeErrors((current) => {
      const next = { ...current };
      delete next[provider.id];
      return next;
    });

    try {
      const response = await probe({ providerId: provider.id });
      if (!response.result) {
        throw new Error(response.error ?? 'Memory probe failed.');
      }
      setProbeResults((current) => ({ ...current, [provider.id]: response.result! }));
    } catch (probeErrorValue) {
      setProbeErrors((current) => ({
        ...current,
        [provider.id]: probeErrorValue instanceof Error ? probeErrorValue.message : String(probeErrorValue),
      }));
    } finally {
      setProbingProviderId(null);
    }
  };

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-hermes-memory-providers"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Database size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-accent">
            {t('fleet.hermesMemoryProviders.title', 'Hermes memory providers')}
          </span>
        </div>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${statusClass}`}>
          {visibleReadiness
            ? statusText
            : t('fleet.hermesMemoryProviders.loadingChip', 'memory')}
        </span>
      </div>

      {visibleReadiness ? (
        <>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-[10px] text-text-secondary">
            <MemoryMetric
              icon={<HardDrive size={10} />}
              label={t('fleet.hermesMemoryProviders.activeLabel', 'Active')}
              value={visibleReadiness.activeProviderId}
              tone={visibleReadiness.ok ? 'success' : 'warning'}
            />
            <MemoryMetric
              icon={<Cloud size={10} />}
              label={t('fleet.hermesMemoryProviders.remoteLabel', 'Remote')}
              value={String(visibleReadiness.configuredRemoteCount)}
              tone={visibleReadiness.configuredRemoteCount > 0 ? 'success' : 'default'}
            />
            <MemoryMetric
              icon={<AlertTriangle size={10} />}
              label={t('fleet.hermesMemoryProviders.missingLabel', 'Missing')}
              value={String(visibleReadiness.missingOfficialCount)}
              tone={visibleReadiness.missingOfficialCount > 0 ? 'warning' : 'success'}
            />
          </div>

          <div className="mt-1.5 grid gap-1">
            {visibleReadiness.providers.slice(0, 6).map((provider) => (
              <MemoryProviderRow
                key={provider.id}
                provider={provider}
                isProbing={probingProviderId === provider.id}
                onProbe={handleProbe}
                probeError={probeErrors[provider.id]}
                probeResult={probeResults[provider.id]}
              />
            ))}
          </div>

          {visibleReadiness.issues.slice(0, 2).map((issue) => (
            <div
              key={issue}
              className="mt-1.5 flex min-w-0 items-start gap-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning"
            >
              <AlertTriangle size={10} className="mt-0.5 shrink-0" />
              <span className="min-w-0">{issue}</span>
            </div>
          ))}

          {visibleReadiness.issues.length === 0 && visibleReadiness.recommendations[0] ? (
            <div className="mt-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
              {visibleReadiness.recommendations[0]}
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
          <AlertTriangle size={10} className="shrink-0 text-warning" />
          <span className="truncate">
            {t('fleet.hermesMemoryProviders.unavailable', 'Hermes memory provider readiness is not loaded yet.')}
          </span>
        </div>
      )}

      {visibleError && (
        <div className="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          {t('fleet.hermesMemoryProviders.loadFailed', 'Hermes memory provider load failed')}: {visibleError}
        </div>
      )}

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
        <Terminal size={10} className="shrink-0 text-text-muted" />
        <code className="truncate">{command}</code>
      </div>
    </section>
  );
};

const MemoryProviderRow: React.FC<{
  isProbing?: boolean;
  onProbe?: (provider: HermesMemoryProviderReviewItem) => void;
  probeError?: string;
  probeResult?: HermesMemoryProbeResult;
  provider: HermesMemoryProviderReviewItem;
}> = ({ isProbing = false, onProbe, probeError, probeResult, provider }) => {
  const { t } = useTranslation();
  const statusLabels: Record<HermesMemoryProviderStatus, string> = {
    available: t('fleet.hermesMemoryProviders.status.available', 'available'),
    configured: t('fleet.hermesMemoryProviders.status.configured', 'configured'),
    fallback: t('fleet.hermesMemoryProviders.status.fallback', 'local fallback'),
    missing: t('fleet.hermesMemoryProviders.status.missing', 'missing'),
  };
  const tone = provider.status === 'available' || provider.status === 'configured'
    ? 'text-success'
    : provider.status === 'fallback'
      ? 'text-warning'
      : 'text-text-muted';
  const credentialLabel =
    provider.credentialSources.length > 0
      ? provider.credentialSources.join(', ')
      : t('fleet.hermesMemoryProviders.noCredentials', 'no credentials');
  const canProbe = Boolean(onProbe && provider.registered);
  const verdictTone =
    probeResult?.verdict === 'pass'
      ? 'text-success'
      : probeResult?.verdict === 'pending'
        ? 'text-warning'
        : 'text-warning';

  return (
    <div className="min-w-0 rounded bg-surface/80 px-2 py-1 text-[10px]">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {provider.active ? <CheckCircle2 size={10} className="shrink-0 text-success" /> : null}
          <span className="min-w-0 truncate text-text-secondary">{provider.label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {provider.registered ? (
            <button
              aria-label={t('fleet.hermesMemoryProviders.probe', 'Run live probe')}
              className="rounded border border-border-muted bg-background p-0.5 text-text-muted transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
              data-testid={`hermes-memory-probe-${provider.id}`}
              disabled={!canProbe || isProbing}
              onClick={() => onProbe?.(provider)}
              title={t('fleet.hermesMemoryProviders.probe', 'Run live probe')}
              type="button"
            >
              <PlayCircle size={10} />
            </button>
          ) : null}
          <span className={`rounded bg-background px-1 py-0.5 text-[9px] ${tone}`}>
            {statusLabels[provider.status]}
          </span>
        </div>
      </div>
      <div className="mt-0.5 flex min-w-0 flex-wrap gap-1 text-[9px] text-text-muted">
        <span>{provider.id}</span>
        <span>{provider.registered ? 'registered=yes' : 'registered=no'}</span>
        <span className="min-w-0 truncate">{credentialLabel}</span>
      </div>
      {probeResult || probeError ? (
        <div
          className={`mt-0.5 truncate rounded bg-background px-1 py-0.5 text-[9px] ${
            probeResult ? verdictTone : 'text-warning'
          }`}
          data-testid={`hermes-memory-probe-result-${provider.id}`}
        >
          {probeResult
            ? t('fleet.hermesMemoryProviders.probeResult', 'probe {{verdict}}: wrote={{wrote}} read={{retrieved}}', {
                retrieved: String(probeResult.retrieved),
                verdict: probeResult.verdict,
                wrote: String(probeResult.wrote),
              })
            : probeError}
        </div>
      ) : null}
    </div>
  );
};

const MemoryMetric: React.FC<{
  icon: React.ReactNode;
  label: string;
  tone?: 'default' | 'success' | 'warning';
  value: string;
}> = ({ icon, label, tone = 'default', value }) => {
  const valueClass =
    tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-text-secondary';
  return (
    <div className="min-w-0 rounded bg-surface/80 px-2 py-1">
      <div className="flex min-w-0 items-center gap-1 text-[9px] uppercase tracking-wider text-text-muted">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-0.5 truncate ${valueClass}`}>{value}</div>
    </div>
  );
};

function getHermesMemoryProvidersApi(): HermesMemoryProvidersApi | undefined {
  return (
    window as unknown as {
      electronAPI?: {
        tools?: {
          hermesMemoryProviders?: HermesMemoryProvidersApi;
        };
      };
    }
  ).electronAPI?.tools?.hermesMemoryProviders;
}
