import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Stethoscope, Terminal, XCircle } from 'lucide-react';

export interface HermesDoctorAreaReview {
  id: string;
  label: string;
  ok: boolean;
}

export interface HermesDoctorReview {
  agentName: string | null;
  areas: HermesDoctorAreaReview[];
  command: string;
  disabledToolCount: number;
  dispatchProfile: string;
  enabledToolCount: number;
  issues: string[];
  ok: boolean;
  recommendations: string[];
  source: 'built-in' | 'user' | 'missing';
}

interface HermesDoctorApi {
  get?: () => Promise<HermesDoctorReview | null>;
}

export const HermesDoctorStrip: React.FC<{
  error?: string | null;
  readiness?: HermesDoctorReview | null;
}> = ({ error = null, readiness }) => {
  const { t } = useTranslation();
  const [loadedReadiness, setLoadedReadiness] = useState<HermesDoctorReview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const visibleReadiness = readiness ?? loadedReadiness;
  const visibleError = error ?? loadError;
  const command = visibleReadiness?.command ?? 'buddy hermes doctor --json';
  const statusClass = visibleReadiness?.ok
    ? 'border-success/40 bg-success/10 text-success'
    : 'border-warning/40 bg-warning/10 text-warning';
  const statusText = visibleReadiness?.ok
    ? t('fleet.hermesDoctor.readyChip', 'healthy')
    : t('fleet.hermesDoctor.attentionChip', 'attention');

  useEffect(() => {
    if (readiness !== undefined) return;
    const api = getHermesDoctorApi();
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
      data-testid="fleet-hermes-doctor"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Stethoscope size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-accent">
            {t('fleet.hermesDoctor.title', 'Hermes doctor')}
          </span>
        </div>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${statusClass}`}>
          {visibleReadiness ? statusText : t('fleet.hermesDoctor.loadingChip', 'doctor')}
        </span>
      </div>

      {visibleReadiness ? (
        <>
          <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2 rounded bg-surface/80 px-2 py-1 text-[10px]">
            <span className="min-w-0 truncate text-text-secondary">
              {visibleReadiness.agentName ?? t('fleet.hermesDoctor.noAgent', 'Hermes agent')}
            </span>
            <span className="shrink-0 rounded bg-background px-1 py-0.5 text-[9px] text-accent">
              {visibleReadiness.dispatchProfile}
            </span>
          </div>

          <div className="mt-1.5 grid grid-cols-2 gap-1">
            {visibleReadiness.areas.map((area) => (
              <div
                key={area.id}
                className="flex min-w-0 items-center gap-1 rounded bg-surface/80 px-2 py-1 text-[10px]"
                data-testid={`hermes-doctor-area-${area.id}`}
              >
                {area.ok ? (
                  <CheckCircle2 size={10} className="shrink-0 text-success" />
                ) : (
                  <XCircle size={10} className="shrink-0 text-warning" />
                )}
                <span className="min-w-0 truncate text-text-secondary">{area.label}</span>
              </div>
            ))}
          </div>

          <div className="mt-1.5 truncate rounded bg-surface/80 px-2 py-1 text-[9px] text-text-muted">
            {t('fleet.hermesDoctor.toolsSummary', '{{enabled}} tools enabled / {{disabled}} disabled', {
              enabled: visibleReadiness.enabledToolCount,
              disabled: visibleReadiness.disabledToolCount,
            })}
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
            {t('fleet.hermesDoctor.unavailable', 'Hermes diagnostics are not loaded yet.')}
          </span>
        </div>
      )}

      {visibleError && (
        <div className="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          {t('fleet.hermesDoctor.loadFailed', 'Hermes doctor load failed')}: {visibleError}
        </div>
      )}

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
        <Terminal size={10} className="shrink-0 text-text-muted" />
        <code className="truncate">{command}</code>
      </div>
    </section>
  );
};

function getHermesDoctorApi(): HermesDoctorApi | undefined {
  return (
    window as unknown as {
      electronAPI?: { tools?: { hermesDoctor?: HermesDoctorApi } };
    }
  ).electronAPI?.tools?.hermesDoctor;
}
