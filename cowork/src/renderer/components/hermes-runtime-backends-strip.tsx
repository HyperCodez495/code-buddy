import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Server,
  ShieldCheck,
  Terminal,
} from 'lucide-react';

export type HermesRuntimeBackendStatus = 'available' | 'configured' | 'missing' | 'unsupported';

export interface HermesRuntimeBackendReviewItem {
  command: string | null;
  configured: boolean;
  credentialSources: string[];
  id: string;
  installed: boolean;
  label: string;
  notes: string[];
  officialSurface: string;
  remediation: string[];
  runnable: boolean;
  smokeCommand: string | null;
  status: HermesRuntimeBackendStatus;
  version: string | null;
}

export interface HermesRuntimeBackendsReview {
  arch: string;
  availableCount: number;
  backends: HermesRuntimeBackendReviewItem[];
  command: string;
  configuredRemoteCount: number;
  generatedAt: string;
  issues: string[];
  ok: boolean;
  platform: string;
  recommendations: string[];
  runnableCount: number;
}

interface HermesRuntimeBackendsApi {
  get?: () => Promise<HermesRuntimeBackendsReview | null>;
}

export const HermesRuntimeBackendsStrip: React.FC<{
  error?: string | null;
  readiness?: HermesRuntimeBackendsReview | null;
}> = ({ error = null, readiness }) => {
  const { t } = useTranslation();
  const [loadedReadiness, setLoadedReadiness] = useState<HermesRuntimeBackendsReview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const visibleReadiness = readiness ?? loadedReadiness;
  const visibleError = error ?? loadError;
  const command = useMemo(
    () => visibleReadiness?.command ?? 'buddy hermes doctor balanced --json',
    [visibleReadiness?.command]
  );
  const statusClass = visibleReadiness?.ok
    ? 'border-success/40 bg-success/10 text-success'
    : 'border-warning/40 bg-warning/10 text-warning';
  const statusText = visibleReadiness?.ok
    ? t('fleet.hermesRuntimeBackends.readyChip', 'runtime ready')
    : t('fleet.hermesRuntimeBackends.attentionChip', 'runtime attention');

  useEffect(() => {
    if (readiness !== undefined) return;
    const api = getHermesRuntimeBackendsApi();
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
        setLoadError(
          loadErrorValue instanceof Error ? loadErrorValue.message : String(loadErrorValue)
        );
      });

    return () => {
      cancelled = true;
    };
  }, [readiness]);

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-hermes-runtime-backends"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Server size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-accent">
            {t('fleet.hermesRuntimeBackends.title', 'Hermes runtime backends')}
          </span>
        </div>
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${statusClass}`}
        >
          {visibleReadiness
            ? statusText
            : t('fleet.hermesRuntimeBackends.loadingChip', 'runtime')}
        </span>
      </div>

      {visibleReadiness ? (
        <>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-[10px] text-text-secondary">
            <RuntimeMetric
              icon={<CheckCircle2 size={10} />}
              label={t('fleet.hermesRuntimeBackends.runnableLabel', 'Runnable')}
              value={t('fleet.hermesRuntimeBackends.runnableValue', '{{count}}/{{total}}', {
                count: visibleReadiness.runnableCount,
                total: visibleReadiness.backends.length,
              })}
              tone={visibleReadiness.runnableCount > 0 ? 'success' : 'warning'}
            />
            <RuntimeMetric
              icon={<Cloud size={10} />}
              label={t('fleet.hermesRuntimeBackends.remoteLabel', 'Remote')}
              value={String(visibleReadiness.configuredRemoteCount)}
              tone={visibleReadiness.configuredRemoteCount > 0 ? 'success' : 'default'}
            />
            <RuntimeMetric
              icon={<ShieldCheck size={10} />}
              label={t('fleet.hermesRuntimeBackends.platformLabel', 'Platform')}
              value={`${visibleReadiness.platform}/${visibleReadiness.arch}`}
            />
          </div>

          <div className="mt-1.5 grid gap-1">
            {visibleReadiness.backends.map((backend) => (
              <BackendRow key={backend.id} backend={backend} />
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
            {t('fleet.hermesRuntimeBackends.unavailable', 'Hermes runtime backends are not loaded yet.')}
          </span>
        </div>
      )}

      {visibleError && (
        <div className="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          {t('fleet.hermesRuntimeBackends.loadFailed', 'Hermes runtime backend load failed')}: {visibleError}
        </div>
      )}

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
        <Terminal size={10} className="shrink-0 text-text-muted" />
        <code className="truncate">{command}</code>
      </div>
    </section>
  );
};

const BackendRow: React.FC<{ backend: HermesRuntimeBackendReviewItem }> = ({ backend }) => {
  const { t } = useTranslation();
  const tone = backend.runnable
    ? 'text-success'
    : backend.installed
      ? 'text-warning'
      : 'text-text-muted';
  const smoke = backend.smokeCommand ?? backend.command ?? backend.id;
  const statusLabels: Record<HermesRuntimeBackendStatus, string> = {
    available: t('fleet.hermesRuntimeBackends.status.available', 'available'),
    configured: t('fleet.hermesRuntimeBackends.status.configured', 'configured'),
    missing: t('fleet.hermesRuntimeBackends.status.missing', 'missing'),
    unsupported: t('fleet.hermesRuntimeBackends.status.unsupported', 'unsupported'),
  };
  return (
    <div className="min-w-0 rounded bg-surface/80 px-2 py-1 text-[10px]">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-text-secondary">{backend.label}</span>
        <span className={`shrink-0 rounded bg-background px-1 py-0.5 text-[9px] ${tone}`}>
          {statusLabels[backend.status]}
        </span>
      </div>
      <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[9px] text-text-muted">
        <span className="shrink-0">{backend.id}</span>
        <span className="truncate">
          {backend.version ?? t('fleet.hermesRuntimeBackends.noVersion', 'no version')}
        </span>
      </div>
      <div className="mt-0.5 truncate font-mono text-[9px] text-text-muted">{smoke}</div>
    </div>
  );
};

const RuntimeMetric: React.FC<{
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

function getHermesRuntimeBackendsApi(): HermesRuntimeBackendsApi | undefined {
  return (
    window as unknown as {
      electronAPI?: {
        tools?: {
          hermesRuntimeBackends?: HermesRuntimeBackendsApi;
        };
      };
    }
  ).electronAPI?.tools?.hermesRuntimeBackends;
}
