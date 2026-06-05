import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Cloud, KeyRound, Terminal } from 'lucide-react';

export type HermesPortalToolKey = 'web' | 'image_gen' | 'tts' | 'browser' | 'modal';

export interface HermesPortalToolReviewItem {
  configured: boolean;
  credentialEnv: string[];
  currentProvider: string | null;
  key: HermesPortalToolKey;
  label: string;
  managedByNous: boolean;
  notes: string[];
  partner: string;
}

export interface HermesPortalReview {
  command: string;
  configuredToolCount: number;
  generatedAt: string;
  loggedIn: boolean;
  managedByNousCount: number;
  notConfiguredToolCount: number;
  notes: string[];
  ok: boolean;
  portal: {
    authFilePresent: boolean;
    credentialPresent: boolean;
    credentialSources: string[];
    docsUrl: string;
    portalBaseUrl: string;
    selectedInferenceProvider: string | null;
    selectedModel: string | null;
    selectedViaNous: boolean;
    subscriptionUrl: string;
    toolGatewayConfigured: boolean;
    toolGatewayUrl: string | null;
  };
  routingActive: boolean;
  tools: HermesPortalToolReviewItem[];
}

interface HermesPortalApi {
  get?: () => Promise<HermesPortalReview | null>;
}

export const HermesPortalStrip: React.FC<{
  error?: string | null;
  readiness?: HermesPortalReview | null;
}> = ({ error = null, readiness }) => {
  const { t } = useTranslation();
  const [loadedReadiness, setLoadedReadiness] = useState<HermesPortalReview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const visibleReadiness = readiness ?? loadedReadiness;
  const visibleError = error ?? loadError;
  const command = visibleReadiness?.command ?? 'buddy hermes portal status --json';
  const statusClass = visibleReadiness?.ok
    ? 'border-success/40 bg-success/10 text-success'
    : 'border-warning/40 bg-warning/10 text-warning';
  const statusText = visibleReadiness?.ok
    ? t('fleet.hermesPortal.readyChip', 'portal ready')
    : t('fleet.hermesPortal.attentionChip', 'portal attention');

  useEffect(() => {
    if (readiness !== undefined) return;
    const api = getHermesPortalApi();
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
      data-testid="fleet-hermes-portal"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Cloud size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-accent">
            {t('fleet.hermesPortal.title', 'Hermes Nous Portal')}
          </span>
        </div>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${statusClass}`}>
          {visibleReadiness ? statusText : t('fleet.hermesPortal.loadingChip', 'portal')}
        </span>
      </div>

      {visibleReadiness ? (
        <>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-[10px] text-text-secondary">
            <PortalMetric
              icon={<KeyRound size={10} />}
              label={t('fleet.hermesPortal.loginLabel', 'Login')}
              value={
                visibleReadiness.loggedIn
                  ? t('fleet.hermesPortal.loggedIn', 'logged in')
                  : t('fleet.hermesPortal.loggedOut', 'logged out')
              }
              tone={visibleReadiness.loggedIn ? 'success' : 'warning'}
            />
            <PortalMetric
              icon={<CheckCircle2 size={10} />}
              label={t('fleet.hermesPortal.toolsLabel', 'Gateway tools')}
              value={t('fleet.hermesPortal.toolsValue', '{{configured}}/{{total}}', {
                configured: visibleReadiness.configuredToolCount + visibleReadiness.managedByNousCount,
                total: visibleReadiness.tools.length,
              })}
              tone={visibleReadiness.notConfiguredToolCount === 0 ? 'success' : 'default'}
            />
            <PortalMetric
              icon={<Cloud size={10} />}
              label={t('fleet.hermesPortal.routingLabel', 'Routing')}
              value={
                visibleReadiness.routingActive
                  ? t('fleet.hermesPortal.routingActive', 'active')
                  : t('fleet.hermesPortal.routingDirect', 'direct')
              }
              tone={visibleReadiness.routingActive ? 'success' : 'default'}
            />
          </div>

          {visibleReadiness.portal.credentialSources.length > 0 ? (
            <div className="mt-1.5 truncate rounded bg-surface/80 px-2 py-1 text-[9px] text-text-muted">
              {t('fleet.hermesPortal.credentialSources', 'Credential sources')}:{' '}
              {visibleReadiness.portal.credentialSources.join(', ')}
            </div>
          ) : null}

          <div className="mt-1.5 grid gap-1">
            {visibleReadiness.tools.map((tool) => (
              <PortalToolRow key={tool.key} tool={tool} />
            ))}
          </div>

          {visibleReadiness.notes.slice(0, 1).map((note) => (
            <div
              key={note}
              className="mt-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted"
            >
              {note}
            </div>
          ))}
        </>
      ) : (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
          <AlertTriangle size={10} className="shrink-0 text-warning" />
          <span className="truncate">
            {t('fleet.hermesPortal.unavailable', 'Hermes Nous Portal status is not loaded yet.')}
          </span>
        </div>
      )}

      {visibleError && (
        <div className="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          {t('fleet.hermesPortal.loadFailed', 'Hermes portal load failed')}: {visibleError}
        </div>
      )}

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
        <Terminal size={10} className="shrink-0 text-text-muted" />
        <code className="truncate">{command}</code>
      </div>
    </section>
  );
};

const PortalToolRow: React.FC<{ tool: HermesPortalToolReviewItem }> = ({ tool }) => {
  const { t } = useTranslation();
  const tone = tool.configured
    ? 'text-success'
    : tool.managedByNous
      ? 'text-accent'
      : 'text-text-muted';
  const statusLabel = tool.configured
    ? t('fleet.hermesPortal.tool.configured', 'configured')
    : tool.managedByNous
      ? t('fleet.hermesPortal.tool.managed', 'managed')
      : t('fleet.hermesPortal.tool.missing', 'not set');
  return (
    <div className="min-w-0 rounded bg-surface/80 px-2 py-1 text-[10px]">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-text-secondary">{tool.label}</span>
        <span className={`shrink-0 rounded bg-background px-1 py-0.5 text-[9px] ${tone}`}>
          {statusLabel}
        </span>
      </div>
      <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[9px] text-text-muted">
        <span className="shrink-0">{tool.partner}</span>
        <span className="truncate">
          {tool.currentProvider ?? t('fleet.hermesPortal.tool.noProvider', 'no provider')}
        </span>
      </div>
    </div>
  );
};

const PortalMetric: React.FC<{
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

function getHermesPortalApi(): HermesPortalApi | undefined {
  return (
    window as unknown as {
      electronAPI?: {
        tools?: {
          hermesPortal?: HermesPortalApi;
        };
      };
    }
  ).electronAPI?.tools?.hermesPortal;
}
