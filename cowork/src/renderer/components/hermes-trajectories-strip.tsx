import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, FlaskConical, Route, Terminal, Download } from 'lucide-react';

export type HermesTrajectoryCapabilityStatus = 'available' | 'partial' | 'missing';

export interface HermesTrajectoryCapabilityReviewItem {
  commands: string[];
  id: string;
  label: string;
  notes: string[];
  officialSurface: string;
  status: HermesTrajectoryCapabilityStatus;
}

export interface HermesTrajectoriesReview {
  availableCount: number;
  capabilities: HermesTrajectoryCapabilityReviewItem[];
  command: string;
  generatedAt: string;
  goldenFixtureCount: number;
  missingCount: number;
  ok: boolean;
  partialCount: number;
  policyEvalCount: number;
  recommendations: string[];
  total: number;
}

interface HermesTrajectoriesApi {
  get?: () => Promise<HermesTrajectoriesReview | null>;
  export?: (options?: any) => Promise<{ success: boolean; path?: string; error?: string }>;
}

export const HermesTrajectoriesStrip: React.FC<{
  error?: string | null;
  readiness?: HermesTrajectoriesReview | null;
}> = ({ error = null, readiness }) => {
  const { t } = useTranslation();
  const [loadedReadiness, setLoadedReadiness] = useState<HermesTrajectoriesReview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const visibleReadiness = readiness ?? loadedReadiness;
  const visibleError = error ?? loadError ?? exportError;
  const command = visibleReadiness?.command ?? 'buddy hermes trajectories status --json';
  const statusClass = visibleReadiness?.ok
    ? 'border-success/40 bg-success/10 text-success'
    : 'border-warning/40 bg-warning/10 text-warning';
  const statusText = visibleReadiness?.ok
    ? t('fleet.hermesTrajectories.readyChip', 'trajectories ready')
    : t('fleet.hermesTrajectories.attentionChip', 'trajectories attention');

  useEffect(() => {
    if (readiness !== undefined) return;
    const api = getHermesTrajectoriesApi();
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

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-hermes-trajectories"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Route size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-accent">
            {t('fleet.hermesTrajectories.title', 'Hermes research trajectories')}
          </span>
        </div>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${statusClass}`}>
          {visibleReadiness ? statusText : t('fleet.hermesTrajectories.loadingChip', 'trajectories')}
        </span>
      </div>

      {visibleReadiness ? (
        <>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-[10px] text-text-secondary">
            <TrajectoryMetric
              label={t('fleet.hermesTrajectories.capabilitiesLabel', 'Capabilities')}
              value={t('fleet.hermesTrajectories.capabilitiesValue', '{{available}}/{{total}}', {
                available: visibleReadiness.availableCount,
                total: visibleReadiness.total,
              })}
              tone={visibleReadiness.missingCount === 0 ? 'success' : 'warning'}
            />
            <TrajectoryMetric
              label={t('fleet.hermesTrajectories.goldenLabel', 'Golden evals')}
              value={String(visibleReadiness.goldenFixtureCount)}
            />
            <TrajectoryMetric
              label={t('fleet.hermesTrajectories.policyLabel', 'Policy evals')}
              value={String(visibleReadiness.policyEvalCount)}
            />
          </div>

          <div className="mt-1.5 grid gap-1">
            {visibleReadiness.capabilities.map((capability) => (
              <CapabilityRow key={capability.id} capability={capability} />
            ))}
          </div>

          {visibleReadiness.recommendations.slice(0, 1).map((rec) => (
            <div key={rec} className="mt-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
              {rec}
            </div>
          ))}
        </>
      ) : (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
          <AlertTriangle size={10} className="shrink-0 text-warning" />
          <span className="truncate">
            {t('fleet.hermesTrajectories.unavailable', 'Hermes trajectory status is not loaded yet.')}
          </span>
        </div>
      )}

      {visibleError && (
        <div className="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          {t('fleet.hermesTrajectories.loadFailed', 'Hermes trajectory load failed')}: {visibleError}
        </div>
      )}

      <div className="mt-1.5 flex items-center justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
          <Terminal size={10} className="shrink-0 text-text-muted" />
          <code className="truncate">{command}</code>
        </div>
        <button
          onClick={async () => {
            const api = getHermesTrajectoriesApi();
            if (!api?.export) return;
            setIsExporting(true);
            setExportError(null);
            try {
              const res = await api.export();
              if (!res.success) {
                setExportError(res.error || 'Export failed');
              }
            } catch (err) {
              setExportError(err instanceof Error ? err.message : String(err));
            } finally {
              setIsExporting(false);
            }
          }}
          disabled={isExporting}
          className="ml-2 flex shrink-0 items-center gap-1 rounded bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
          title={t('fleet.hermesTrajectories.exportTitle', 'Export trajectory batch')}
        >
          <Download size={10} />
          <span>{isExporting ? t('common.exporting', 'Exporting...') : t('common.export', 'Export')}</span>
        </button>
      </div>
    </section>
  );
};

const CapabilityRow: React.FC<{ capability: HermesTrajectoryCapabilityReviewItem }> = ({ capability }) => {
  const { t } = useTranslation();
  const tone =
    capability.status === 'available'
      ? 'text-success'
      : capability.status === 'partial'
        ? 'text-warning'
        : 'text-text-muted';
  const statusLabels: Record<HermesTrajectoryCapabilityStatus, string> = {
    available: t('fleet.hermesTrajectories.status.available', 'available'),
    partial: t('fleet.hermesTrajectories.status.partial', 'partial'),
    missing: t('fleet.hermesTrajectories.status.missing', 'missing'),
  };
  return (
    <div className="min-w-0 rounded bg-surface/80 px-2 py-1 text-[10px]">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-text-secondary">{capability.label}</span>
        <span className={`shrink-0 rounded bg-background px-1 py-0.5 text-[9px] ${tone}`}>
          {statusLabels[capability.status]}
        </span>
      </div>
      {capability.commands[0] ? (
        <div className="mt-0.5 flex min-w-0 items-center gap-1 truncate font-mono text-[9px] text-text-muted">
          <FlaskConical size={9} className="shrink-0" />
          <span className="truncate">{capability.commands[0]}</span>
        </div>
      ) : null}
    </div>
  );
};

const TrajectoryMetric: React.FC<{
  label: string;
  tone?: 'default' | 'success' | 'warning';
  value: string;
}> = ({ label, tone = 'default', value }) => {
  const valueClass =
    tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-text-secondary';
  return (
    <div className="min-w-0 rounded bg-surface/80 px-2 py-1">
      <div className="truncate text-[9px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`mt-0.5 truncate ${valueClass}`}>{value}</div>
    </div>
  );
};

function getHermesTrajectoriesApi(): HermesTrajectoriesApi | undefined {
  return (
    window as unknown as {
      electronAPI?: { tools?: { hermesTrajectories?: HermesTrajectoriesApi } };
    }
  ).electronAPI?.tools?.hermesTrajectories;
}
