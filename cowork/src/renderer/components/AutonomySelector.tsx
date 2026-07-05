/**
 * AutonomySelector — segmented control for the agent's autonomy posture.
 *
 * The Genspark-style "autopilot level": how much the agent is allowed to do
 * on its own before it comes back for a human decision. Three postures,
 * least to most autonomous:
 *   - `plan` — read-only. Reads/search only, no writes, no shell.
 *   - `auto` — auto-edit. Edits files and runs safe commands, still guarded.
 *   - `full` — full-auto (YOLO). High autonomy, minimal interruption.
 *
 * This component is purely presentational: it renders `value` and reports
 * intent via `onChange`. It owns no state, talks to no store, and makes no
 * IPC calls — the caller decides what posture change actually means (e.g.
 * wiring it to a permission mode or a YOLO toggle).
 *
 * @module renderer/components/AutonomySelector
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, Pencil, Zap } from 'lucide-react';

export type AutonomyMode = 'plan' | 'auto' | 'full';

export interface AutonomySelectorProps {
  value: AutonomyMode;
  onChange: (mode: AutonomyMode) => void;
  className?: string;
  disabled?: boolean;
}

export const AutonomySelector: React.FC<AutonomySelectorProps> = ({
  value,
  onChange,
  className,
  disabled = false,
}) => {
  const { t } = useTranslation();

  const segments: Array<{
    mode: AutonomyMode;
    Icon: typeof Eye;
    label: string;
    title: string;
  }> = [
    {
      mode: 'plan',
      Icon: Eye,
      label: t('autonomy.plan', 'Plan'),
      title: t(
        'autonomy.plan.desc',
        'Read-only — reads and search only, no writes, no shell commands',
      ),
    },
    {
      mode: 'auto',
      Icon: Pencil,
      label: t('autonomy.auto', 'Auto'),
      title: t(
        'autonomy.auto.desc',
        'Auto-edit — edits files and runs safe commands, still guarded',
      ),
    },
    {
      mode: 'full',
      Icon: Zap,
      label: t('autonomy.full', 'Full'),
      title: t(
        'autonomy.full.desc',
        'Full-auto (YOLO) — high autonomy, minimal interruption',
      ),
    },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t('autonomy.label', 'Autonomy level')}
      data-testid="autonomy-selector"
      className={`inline-flex items-center rounded-md border border-border overflow-hidden ${className ?? ''}`}
    >
      {segments.map(({ mode, Icon, label, title }) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            aria-pressed={active}
            disabled={disabled}
            data-testid={`autonomy-${mode}`}
            title={title}
            onClick={() => onChange(mode)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              active ? 'bg-accent/15 text-accent' : 'text-text-muted hover:bg-border'
            }`}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default AutonomySelector;
