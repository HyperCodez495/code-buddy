/**
 * SettingsTelemetry — P4.3
 *
 * Opt-in UI for the three telemetry surfaces Cowork can use:
 *   - Sentry crash reporting (errors only)
 *   - OpenTelemetry traces
 *   - Anonymous usage stats
 *
 * Persists into the app config under the `telemetry` namespace; the main
 * process reads this on next boot. Env vars (SENTRY_DSN, OTEL_*) remain the
 * authoritative source if set — the UI surfaces this clearly.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, ShieldCheck, Bug, BarChart3, ExternalLink } from 'lucide-react';

interface TelemetryConfig {
  sentryEnabled?: boolean;
  otelEnabled?: boolean;
  usageStatsEnabled?: boolean;
}

export function SettingsTelemetry() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<TelemetryConfig>({});
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const api = window.electronAPI?.config?.get;
    if (!api) return;
    setLoading(true);
    try {
      const full = (await api()) as { telemetry?: TelemetryConfig };
      setCfg(full?.telemetry ?? {});
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveOne = async (next: TelemetryConfig) => {
    setCfg(next);
    try {
      await window.electronAPI?.config?.save?.({
        telemetry: next,
      } as Record<string, unknown>);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const Toggle = ({
    label,
    description,
    icon: Icon,
    value,
    onChange,
    testId,
  }: {
    label: string;
    description: string;
    icon: typeof Activity;
    value: boolean;
    onChange: (v: boolean) => void;
    testId: string;
  }) => (
    <label className="flex items-start gap-3 p-3 border border-border-subtle rounded-lg cursor-pointer hover:bg-surface-hover">
      <Icon size={16} className="text-text-muted mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <p className="text-[11px] text-text-muted mt-0.5">{description}</p>
      </div>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1.5 shrink-0 accent-accent"
        data-testid={testId}
      />
    </label>
  );

  return (
    <div className="p-4 space-y-4 max-w-2xl" data-testid="settings-telemetry">
      <div className="flex items-center gap-2">
        <Activity size={16} className="text-text-muted" />
        <h3 className="text-sm font-semibold">{t('telemetry.title', 'Telemetry & diagnostics')}</h3>
      </div>

      <p className="text-xs text-text-muted">
        {t(
          'telemetry.intro',
          'Cowork can collect optional diagnostics to help us fix bugs and improve the product. Everything is off by default. Environment variables (SENTRY_DSN, OTEL_EXPORTER_OTLP_ENDPOINT) override these toggles when set.'
        )}
      </p>

      <div className="space-y-2">
        <Toggle
          icon={Bug}
          label={t('telemetry.sentryLabel', 'Crash reporting (Sentry)')}
          description={t(
            'telemetry.sentryDesc',
            'Send unhandled exceptions and stack traces. No prompt content, no API keys.'
          )}
          value={cfg.sentryEnabled ?? false}
          onChange={(v) => saveOne({ ...cfg, sentryEnabled: v })}
          testId="telemetry-sentry"
        />
        <Toggle
          icon={Activity}
          label={t('telemetry.otelLabel', 'OpenTelemetry traces')}
          description={t(
            'telemetry.otelDesc',
            'Emit OTel spans for agent loops, tool calls, IPC bridges. Useful if you run a local collector.'
          )}
          value={cfg.otelEnabled ?? false}
          onChange={(v) => saveOne({ ...cfg, otelEnabled: v })}
          testId="telemetry-otel"
        />
        <Toggle
          icon={BarChart3}
          label={t('telemetry.usageLabel', 'Anonymous usage stats')}
          description={t(
            'telemetry.usageDesc',
            'Count which features are used (no prompts, no file contents, no identifiers).'
          )}
          value={cfg.usageStatsEnabled ?? false}
          onChange={(v) => saveOne({ ...cfg, usageStatsEnabled: v })}
          testId="telemetry-usage"
        />
      </div>

      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-success/5 border border-success/20">
        <ShieldCheck size={14} className="text-success shrink-0" />
        <p className="text-[11px] text-text-secondary">
          {t(
            'telemetry.privacyPromise',
            'We never collect prompt content, file contents, API keys, or anything identifying you personally.'
          )}
        </p>
      </div>

      {saved && (
        <p className="text-[11px] text-success">
          {t('telemetry.saved', 'Saved. Restart Cowork for changes to take effect.')}
        </p>
      )}

      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          window.electronAPI?.openExternal?.('https://github.com/anthropics/claude-code/blob/main/PRIVACY.md');
        }}
        className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
      >
        {t('telemetry.privacyLink', 'Read the full privacy policy')}
        <ExternalLink size={11} />
      </a>

      {loading && <p className="text-[10px] text-text-muted italic">{t('common.loading', 'Loading…')}</p>}
    </div>
  );
}
