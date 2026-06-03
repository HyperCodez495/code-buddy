import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  LockKeyhole,
  ShieldCheck,
  Smartphone,
  Terminal,
} from 'lucide-react';

export interface HermesMobileSupervisionReview {
  approvalQueue: {
    autoDispatch: boolean;
    counts: {
      blocked: number;
      pending: number;
      ready: number;
      total: number;
    };
    localOnly: boolean;
    remoteExecutionDisabled: boolean;
  };
  auth: {
    scheme: 'bearer_or_pairing_code';
    scopes: string[];
    ttlSeconds: number;
  };
  blockedOperations: Array<{
    action: string;
    reason: string;
  }>;
  command: string;
  endpoints: Array<{
    action: string;
    id: string;
    localApprovalRequired: boolean;
    method: 'GET' | 'POST';
    path: string;
    sideEffects: 'none' | 'draft_only';
  }>;
  ok: boolean;
  pairing: {
    deviceLabel: string;
    deviceLabelMaxChars: number;
    scopes: string[];
    status: 'preview_only';
    tokenIssued: boolean;
    ttlSeconds: number;
  };
  query: string;
  recommendations: string[];
  routeMount: {
    basePath: string;
    serverCommand: string;
    status: 'implemented_not_probed';
  };
  summary: {
    blockedOperations: number;
    draftOnlyEndpoints: number;
    pendingLocalApproval: number;
    readOnlyEndpoints: number;
    readyReadOnly: number;
  };
  transport: {
    offDeviceTlsRequired: boolean;
    remoteExecution: 'disabled';
  };
}

interface HermesMobileSupervisionApi {
  get?: (options?: { query?: string }) => Promise<HermesMobileSupervisionReview | null>;
}

export const HermesMobileSupervisionStrip: React.FC<{
  status?: HermesMobileSupervisionReview | null;
}> = ({ status }) => {
  const { t } = useTranslation();
  const [loadedStatus, setLoadedStatus] = useState<HermesMobileSupervisionReview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const visibleStatus = status ?? loadedStatus;
  const readiness = useMemo(() => getMobileReadiness(visibleStatus), [visibleStatus]);
  const statusClass = readiness.ready
    ? 'border-success/40 bg-success/10 text-success'
    : 'border-warning/40 bg-warning/10 text-warning';

  useEffect(() => {
    if (status !== undefined) return;
    const api = getHermesMobileSupervisionApi();
    if (!api?.get) return;
    let cancelled = false;

    void api
      .get({ query: 'mobile supervision' })
      .then((result) => {
        if (cancelled) return;
        setLoadedStatus(result);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadedStatus(null);
        setLoadError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [status]);

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-hermes-mobile-supervision"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Smartphone size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-accent">
            {t('fleet.hermesMobileSupervision.title', 'Hermes mobile supervision')}
          </span>
        </div>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${statusClass}`}>
          {visibleStatus
            ? readiness.ready
              ? t('fleet.hermesMobileSupervision.readyChip', 'mobile ready')
              : t('fleet.hermesMobileSupervision.attentionChip', 'mobile attention')
            : t('fleet.hermesMobileSupervision.loadingChip', 'mobile')}
        </span>
      </div>

      {visibleStatus ? (
        <>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-[10px] text-text-secondary">
            <MobileMetric
              icon={<FileText size={10} />}
              label={t('fleet.hermesMobileSupervision.readOnlyLabel', 'Read-only')}
              tone="success"
              value={String(visibleStatus.summary.readOnlyEndpoints)}
            />
            <MobileMetric
              icon={<LockKeyhole size={10} />}
              label={t('fleet.hermesMobileSupervision.draftLabel', 'Drafts')}
              tone={visibleStatus.summary.draftOnlyEndpoints > 0 ? 'warning' : 'default'}
              value={String(visibleStatus.summary.draftOnlyEndpoints)}
            />
            <MobileMetric
              icon={<ShieldCheck size={10} />}
              label={t('fleet.hermesMobileSupervision.blockedLabel', 'Blocked')}
              tone="success"
              value={String(visibleStatus.summary.blockedOperations)}
            />
          </div>

          <div className="mt-1.5 grid gap-1">
            {visibleStatus.endpoints.slice(0, 4).map((endpoint) => (
              <div key={endpoint.id} className="min-w-0 rounded bg-surface/80 px-2 py-1 text-[10px]">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-text-secondary">
                    {endpoint.method} {endpoint.path}
                  </span>
                  <span className="shrink-0 rounded bg-background px-1 py-0.5 text-[9px] text-text-muted">
                    {endpoint.sideEffects}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[9px] text-text-muted">{endpoint.action}</div>
              </div>
            ))}
          </div>

          <div
            className={`mt-1.5 flex min-w-0 items-start gap-1.5 rounded border px-2 py-1 text-[10px] ${
              readiness.ready
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-warning/30 bg-warning/10 text-warning'
            }`}
          >
            {readiness.ready ? (
              <CheckCircle2 size={10} className="mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle size={10} className="mt-0.5 shrink-0" />
            )}
            <span className="min-w-0">{readiness.message}</span>
          </div>

          <div className="mt-1.5 flex min-w-0 flex-wrap gap-1 text-[9px] text-text-muted">
            <span className="rounded bg-surface/80 px-1.5 py-0.5">
              {t('fleet.hermesMobileSupervision.queueChip', 'queue {{ready}}/{{total}} ready', {
                ready: visibleStatus.approvalQueue.counts.ready,
                total: visibleStatus.approvalQueue.counts.total,
              })}
            </span>
            <span className="rounded bg-surface/80 px-1.5 py-0.5">
              {t('fleet.hermesMobileSupervision.pairingChip', 'pairing {{status}}', {
                status: visibleStatus.pairing.status,
              })}
            </span>
            <span className="rounded bg-surface/80 px-1.5 py-0.5">
              {t('fleet.hermesMobileSupervision.labelLimitChip', 'label max {{count}} chars', {
                count: visibleStatus.pairing.deviceLabelMaxChars,
              })}
            </span>
            <span className="rounded bg-surface/80 px-1.5 py-0.5">
              {t('fleet.hermesMobileSupervision.remoteChip', 'remote execution {{state}}', {
                state: visibleStatus.transport.remoteExecution,
              })}
            </span>
          </div>
        </>
      ) : (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
          <AlertTriangle size={10} className="shrink-0 text-warning" />
          <span className="truncate">
            {t('fleet.hermesMobileSupervision.unavailable', 'Hermes mobile supervision status is not loaded yet.')}
          </span>
        </div>
      )}

      {loadError && (
        <div className="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          {t('fleet.hermesMobileSupervision.loadFailed', 'Hermes mobile supervision load failed')}: {loadError}
        </div>
      )}

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
        <Terminal size={10} className="shrink-0 text-text-muted" />
        <code className="truncate">{visibleStatus?.command ?? 'buddy hermes mobile status --json'}</code>
      </div>
    </section>
  );
};

const MobileMetric: React.FC<{
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

function getMobileReadiness(status: HermesMobileSupervisionReview | null): {
  message: string | null;
  ready: boolean;
} {
  if (!status) {
    return { message: null, ready: false };
  }
  const safe =
    status.ok &&
    status.approvalQueue.autoDispatch === false &&
    status.approvalQueue.remoteExecutionDisabled === true &&
    status.pairing.tokenIssued === false;
  const message =
    status.recommendations[0] ??
    (safe
      ? 'Mobile supervision is review-only; start the server before pairing a phone.'
      : 'Review mobile supervision safety gates before pairing a phone.');
  return {
    message,
    ready: safe,
  };
}

function getHermesMobileSupervisionApi(): HermesMobileSupervisionApi | undefined {
  return (
    window as unknown as {
      electronAPI?: {
        tools?: {
          hermesMobileSupervision?: HermesMobileSupervisionApi;
        };
      };
    }
  ).electronAPI?.tools?.hermesMobileSupervision;
}
