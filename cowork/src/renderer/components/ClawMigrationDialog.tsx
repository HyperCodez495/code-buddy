/**
 * ClawMigrationDialog — Hermes OpenClaw migration (CLI parity → Cowork)
 *
 * Surfaces `buddy hermes claw status` / `claw migrate`. Loads a DRY-RUN
 * preview on open (never writes), groups planned entries by action, and only
 * performs the real migration after an explicit, confirmed "Run migration".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Loader2, Play, X, XCircle } from 'lucide-react';
import { dialogA11yProps, trapFocus } from '../utils/a11y';
import type {
  ClawMigrationAction,
  ClawMigrationPreset,
  ClawMigrationReportPayload,
  ClawSkillConflictMode,
} from '../types/hermes';

interface ClawMigrationDialogProps {
  onClose: () => void;
}

const ACTION_ORDER: ClawMigrationAction[] = ['import', 'archive', 'conflict', 'skip'];

export function ClawMigrationDialog({ onClose }: ClawMigrationDialogProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [preset, setPreset] = useState<ClawMigrationPreset>('user-data');
  const [skillConflict, setSkillConflict] = useState<ClawSkillConflictMode>('skip');
  const [migrateSecrets, setMigrateSecrets] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [report, setReport] = useState<ClawMigrationReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (dialogRef.current) return trapFocus(dialogRef.current);
  }, []);

  const notAvailableMsg = t('claw.notAvailable', 'OpenClaw migration bridge is not available.');
  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    const api = window.electronAPI?.tools?.hermesClaw;
    if (!api?.status) {
      setError(notAvailableMsg);
      setLoading(false);
      return;
    }
    try {
      const result = await api.status({ preset });
      setReport(result);
      setApplied(false);
      setConfirmRun(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // notAvailableMsg intentionally omitted: it is only used on the missing-bridge
    // path and depending on it would re-fetch whenever the t() identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  // Reload the dry-run preview whenever the preset changes.
  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  const runMigration = async () => {
    const api = window.electronAPI?.tools?.hermesClaw;
    if (!api?.run) {
      setError(t('claw.notAvailable', 'OpenClaw migration bridge is not available.'));
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const response = await api.run({ migrateSecrets, overwrite, preset, skillConflict });
      if (!response.ok && !response.report) {
        throw new Error(response.error ?? 'Migration failed.');
      }
      setReport(response.report ?? null);
      setApplied(true);
      setConfirmRun(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const grouped = useMemo(() => {
    const groups: Record<ClawMigrationAction, ClawMigrationReportPayload['entries']> = {
      import: [],
      archive: [],
      conflict: [],
      skip: [],
    };
    for (const entry of report?.entries ?? []) {
      groups[entry.action].push(entry);
    }
    return groups;
  }, [report]);

  const detected = report?.detected ?? false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl"
        data-testid="claw-migration-dialog"
        {...dialogA11yProps(t('claw.title', 'OpenClaw migration'))}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">
            {t('claw.title', 'OpenClaw migration')}
          </h2>
          <button
            aria-label={t('common.close', 'Close')}
            className="rounded p-1 text-text-muted hover:bg-surface hover:text-text-primary"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 text-xs">
          {/* Detection banner */}
          {loading ? (
            <div className="flex items-center gap-2 text-text-muted">
              <Loader2 size={14} className="animate-spin" />
              {t('claw.loading', 'Probing for an OpenClaw installation…')}
            </div>
          ) : detected ? (
            <div className="flex items-start gap-2 rounded border border-success/30 bg-success/10 px-3 py-2 text-success">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div>{t('claw.detected', 'OpenClaw installation detected.')}</div>
                <code className="block truncate text-[11px] text-text-muted">{report?.openClawHome}</code>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-warning">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{t('claw.notDetected', 'No OpenClaw installation found in the standard locations.')}</span>
            </div>
          )}

          {/* Options */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-text-muted">{t('claw.preset', 'Preset')}</span>
              <select
                className="rounded border border-border bg-surface px-2 py-1 text-text-primary"
                data-testid="claw-preset"
                disabled={running}
                onChange={(e) => setPreset(e.target.value as ClawMigrationPreset)}
                value={preset}
              >
                <option value="user-data">{t('claw.presetUserData', 'user-data (user content only)')}</option>
                <option value="full">{t('claw.presetFull', 'full (everything)')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-text-muted">{t('claw.skillConflict', 'Skill conflicts')}</span>
              <select
                className="rounded border border-border bg-surface px-2 py-1 text-text-primary"
                data-testid="claw-skill-conflict"
                disabled={running}
                onChange={(e) => setSkillConflict(e.target.value as ClawSkillConflictMode)}
                value={skillConflict}
              >
                <option value="skip">{t('claw.conflictSkip', 'skip')}</option>
                <option value="rename">{t('claw.conflictRename', 'rename')}</option>
                <option value="overwrite">{t('claw.conflictOverwrite', 'overwrite')}</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                checked={migrateSecrets}
                disabled={running}
                onChange={(e) => setMigrateSecrets(e.target.checked)}
                type="checkbox"
              />
              <span className="text-text-secondary">{t('claw.migrateSecrets', 'Migrate secrets')}</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                checked={overwrite}
                disabled={running}
                onChange={(e) => setOverwrite(e.target.checked)}
                type="checkbox"
              />
              <span className="text-text-secondary">{t('claw.overwrite', 'Overwrite existing files')}</span>
            </label>
          </div>

          {/* Summary */}
          {report ? (
            <div className="mt-3 grid grid-cols-4 gap-2 text-center" data-testid="claw-summary">
              <SummaryCell label={t('claw.import', 'Import')} value={report.summary.import} tone="success" />
              <SummaryCell label={t('claw.archive', 'Archive')} value={report.summary.archive} tone="default" />
              <SummaryCell label={t('claw.conflict', 'Conflict')} value={report.summary.conflict} tone="warning" />
              <SummaryCell label={t('claw.skip', 'Skip')} value={report.summary.skip} tone="muted" />
            </div>
          ) : null}

          {/* Entries grouped by action */}
          {report
            ? ACTION_ORDER.filter((action) => grouped[action].length > 0).map((action) => (
                <div key={action} className="mt-3">
                  <div className="mb-1 text-[11px] uppercase tracking-wider text-text-muted">
                    {t(`claw.${action}`, action)} ({grouped[action].length})
                  </div>
                  <div className="grid gap-1">
                    {grouped[action].map((entry) => (
                      <div
                        key={`${entry.category}-${entry.label}`}
                        className="rounded bg-surface px-2 py-1"
                        data-testid={`claw-entry-${entry.category}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-text-secondary">{entry.label}</span>
                          {entry.applied ? (
                            <CheckCircle2 size={11} className="shrink-0 text-success" />
                          ) : entry.error ? (
                            <XCircle size={11} className="shrink-0 text-warning" />
                          ) : null}
                        </div>
                        <div className="truncate text-[10px] text-text-muted">{entry.detail}</div>
                        {entry.error ? (
                          <div className="truncate text-[10px] text-warning">{entry.error}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            : null}

          {error ? (
            <div className="mt-3 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-warning">
              {error}
            </div>
          ) : null}

          {applied ? (
            <div className="mt-3 rounded border border-success/30 bg-success/10 px-3 py-2 text-success">
              {t('claw.appliedNotice', 'Migration applied. {{count}} item(s) imported.', {
                count: report?.summary.appliedCount ?? 0,
              })}
            </div>
          ) : null}
        </div>

        {/* Footer / actions */}
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <span className="text-[11px] text-text-muted">
            {applied
              ? t('claw.doneHint', 'Migration complete.')
              : t('claw.dryRunHint', 'Preview is read-only until you run the migration.')}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface"
              disabled={running}
              onClick={onClose}
              type="button"
            >
              {t('common.close', 'Close')}
            </button>
            {!applied && detected ? (
              confirmRun ? (
                <button
                  className="flex items-center gap-1.5 rounded bg-warning px-3 py-1.5 text-xs font-medium text-white hover:bg-warning/90 disabled:opacity-50"
                  data-testid="claw-confirm-run"
                  disabled={running}
                  onClick={runMigration}
                  type="button"
                >
                  {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  {running
                    ? t('claw.migrating', 'Migrating {{import}} import · {{archive}} archive…', {
                        import: grouped.import.length,
                        archive: grouped.archive.length,
                      })
                    : t('claw.confirmRun', 'Confirm — write changes')}
                </button>
              ) : (
                <button
                  className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
                  data-testid="claw-run"
                  disabled={running || loading}
                  onClick={() => setConfirmRun(true)}
                  type="button"
                >
                  <Play size={13} />
                  {t('claw.run', 'Run migration…')}
                </button>
              )
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

const SummaryCell: React.FC<{
  label: string;
  tone: 'success' | 'warning' | 'default' | 'muted';
  value: number;
}> = ({ label, tone, value }) => {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'muted'
          ? 'text-text-muted'
          : 'text-text-secondary';
  return (
    <div className="rounded bg-surface px-2 py-1.5">
      <div className={`text-base font-semibold ${toneClass}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
    </div>
  );
};
