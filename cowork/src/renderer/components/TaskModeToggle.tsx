/**
 * TaskModeToggle — Switch between chat and task mode
 * Claude Cowork parity: task mode auto-approves tools for autonomous execution.
 */
import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, MessageSquare, Zap, HelpCircle, Building2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ExecutionMode } from '../types';

interface TaskModeToggleProps {
  mode: ExecutionMode;
  onChange: (mode: ExecutionMode) => void;
}

interface ModeOption {
  value: ExecutionMode;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  color: string;
}

const MODES: ModeOption[] = [
  {
    value: 'chat',
    labelKey: 'taskMode.chat',
    descriptionKey: 'taskMode.chatTooltip',
    icon: MessageSquare,
    color: 'text-accent',
  },
  {
    value: 'task',
    labelKey: 'taskMode.task',
    descriptionKey: 'taskMode.taskTooltip',
    icon: Zap,
    color: 'text-warning',
  },
  {
    value: 'ask',
    labelKey: 'taskMode.ask',
    descriptionKey: 'taskMode.askTooltip',
    icon: HelpCircle,
    color: 'text-info',
  },
  {
    value: 'architect',
    labelKey: 'taskMode.architect',
    descriptionKey: 'taskMode.architectTooltip',
    icon: Building2,
    color: 'text-success',
  },
];

export const TaskModeToggle: React.FC<TaskModeToggleProps> = ({ mode, onChange }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const current = MODES.find((m) => m.value === mode) ?? MODES[0];
  const CurrentIcon = current.icon;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-text-secondary bg-surface hover:bg-surface-hover transition-colors"
        title={t(current.descriptionKey)}
      >
        <CurrentIcon size={12} className={current.color} />
        <span className="font-medium">{t(current.labelKey)}</span>
        <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 w-64 bg-background border border-border rounded-lg shadow-elevated z-50 overflow-hidden">
          {MODES.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.value}
                onClick={() => {
                  onChange(m.value);
                  setOpen(false);
                }}
                className={`w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-surface-hover transition-colors ${
                  m.value === mode ? 'bg-surface-active' : ''
                }`}
              >
                <Icon size={14} className={`${m.color} mt-0.5 shrink-0`} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-text-primary">{t(m.labelKey)}</div>
                  <div className="text-[10px] text-text-muted mt-0.5">{t(m.descriptionKey)}</div>
                </div>
                {m.value === mode && (
                  <span className="text-xs text-success mt-0.5">✓</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
