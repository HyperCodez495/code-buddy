import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Gauge, ListChecks, Terminal } from 'lucide-react';

type HermesToolParityStatus = 'exact' | 'native-equivalent' | 'partial' | 'gap';

export interface HermesToolCatalogGap {
  category: string;
  name: string;
  nextWork?: string;
  status: HermesToolParityStatus;
  toolset: string;
}

export interface HermesToolCatalogSummary {
  generatedAt: string;
  inspectedCommit: string;
  localToolCount: number;
  source: string;
  summary: {
    exact: number;
    gaps: number;
    nativeEquivalent: number;
    partial: number;
    total: number;
  };
  topWork: HermesToolCatalogGap[];
}

interface HermesToolCatalogApi {
  get?: () => Promise<HermesToolCatalogSummary | null>;
}

export function buildHermesToolCatalogCommand(): string {
  return 'buddy hermes tools --json';
}

export const HermesToolCatalogStrip: React.FC<{
  catalog?: HermesToolCatalogSummary | null;
  error?: string | null;
}> = ({ catalog, error = null }) => {
  const { t } = useTranslation();
  const [loadedCatalog, setLoadedCatalog] = useState<HermesToolCatalogSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const command = useMemo(() => buildHermesToolCatalogCommand(), []);
  const visibleCatalog = catalog ?? loadedCatalog;
  const visibleError = error ?? loadError;
  const summary = visibleCatalog?.summary;
  const covered = summary ? summary.exact + summary.nativeEquivalent : 0;

  useEffect(() => {
    if (catalog !== undefined) return;
    const api = getHermesToolCatalogApi();
    if (!api?.get) return;
    let cancelled = false;

    void api
      .get()
      .then((result) => {
        if (cancelled) return;
        setLoadedCatalog(result);
        setLoadError(null);
      })
      .catch((loadErrorValue: unknown) => {
        if (cancelled) return;
        setLoadedCatalog(null);
        setLoadError(
          loadErrorValue instanceof Error ? loadErrorValue.message : String(loadErrorValue)
        );
      });

    return () => {
      cancelled = true;
    };
  }, [catalog]);

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-hermes-tool-catalog"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Gauge size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-accent">
            {t('fleet.hermesToolCatalog.title', 'Hermes tool catalog')}
          </span>
        </div>
        <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
          {summary
            ? t('fleet.hermesToolCatalog.countChip', '{{covered}}/{{total}} covered', {
                covered,
                total: summary.total,
              })
            : t('fleet.hermesToolCatalog.loadingChip', 'catalog')}
        </span>
      </div>

      {summary ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
            {t('fleet.hermesToolCatalog.exactChip', '{{count}} exact', {
              count: summary.exact,
            })}
          </span>
          <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
            {t('fleet.hermesToolCatalog.nativeChip', '{{count}} native', {
              count: summary.nativeEquivalent,
            })}
          </span>
          <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
            {t('fleet.hermesToolCatalog.partialChip', '{{count}} partial', {
              count: summary.partial,
            })}
          </span>
          <span className="rounded bg-warning/10 px-1 py-0.5 text-[9px] text-warning">
            {t('fleet.hermesToolCatalog.gapChip', '{{count}} gaps', {
              count: summary.gaps,
            })}
          </span>
        </div>
      ) : null}

      {visibleError && (
        <div className="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          {t('fleet.hermesToolCatalog.loadFailed', 'Hermes tool catalog load failed')}: {visibleError}
        </div>
      )}

      {visibleCatalog?.topWork.length ? (
        <ul className="mt-1.5 space-y-1">
          {visibleCatalog.topWork.slice(0, 5).map((tool) => (
            <li key={tool.name} className="min-w-0 rounded bg-surface/80 px-2 py-1">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate text-[10px] text-text-secondary">
                  {tool.name}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
                    {tool.category}
                  </span>
                  <span className="rounded bg-warning/10 px-1 py-0.5 text-[9px] text-warning">
                    {tool.status}
                  </span>
                </div>
              </div>
              <div className="mt-0.5 truncate text-[9px] text-text-muted">
                {tool.toolset}
                {tool.nextWork ? ` - ${tool.nextWork}` : ''}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
          {visibleCatalog ? (
            <ListChecks size={10} className="shrink-0 text-text-muted" />
          ) : (
            <AlertTriangle size={10} className="shrink-0 text-warning" />
          )}
          <span className="truncate">
            {visibleCatalog
              ? t('fleet.hermesToolCatalog.empty', 'No prioritized Hermes tool gaps.')
              : t('fleet.hermesToolCatalog.unavailable', 'Hermes tool catalog is not loaded yet.')}
          </span>
        </div>
      )}

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
        <Terminal size={10} className="shrink-0 text-text-muted" />
        <code className="truncate">{command}</code>
      </div>
    </section>
  );
};

function getHermesToolCatalogApi(): HermesToolCatalogApi | undefined {
  return (
    window as unknown as {
      electronAPI?: {
        tools?: {
          hermesCatalog?: HermesToolCatalogApi;
        };
      };
    }
  ).electronAPI?.tools?.hermesCatalog;
}
