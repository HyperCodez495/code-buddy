/**
 * ReasoningLevelPicker — P1.3
 *
 * Compact dropdown to switch the thinking/reasoning level for the next turn.
 * Persists to config (`thinkingLevel`) so the agent-runner picks it up on
 * the next session boot or hot-swap.
 *
 * Levels mirror the core engine's PiThinkingLevel:
 *   off / minimal / low / medium / high / xhigh
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, ChevronDown } from 'lucide-react';

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

const LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

const LEVEL_COLORS: Record<ThinkingLevel, string> = {
  off: 'text-text-muted',
  minimal: 'text-text-secondary',
  low: 'text-info',
  medium: 'text-accent',
  high: 'text-warning',
  xhigh: 'text-error',
};

export function ReasoningLevelPicker() {
  const { t } = useTranslation();
  const [level, setLevel] = useState<ThinkingLevel>('off');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const api = window.electronAPI?.config?.get;
    if (!api) return;
    let cancelled = false;
    api().then((cfg) => {
      if (cancelled) return;
      const explicit = (cfg as { thinkingLevel?: ThinkingLevel }).thinkingLevel;
      const legacy = (cfg as { enableThinking?: boolean }).enableThinking;
      if (explicit && LEVELS.includes(explicit)) {
        setLevel(explicit);
      } else {
        setLevel(legacy ? 'medium' : 'off');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const applyLevel = async (next: ThinkingLevel) => {
    setLevel(next);
    setOpen(false);
    const save = window.electronAPI?.config?.save;
    if (!save) return;
    try {
      await save({
        thinkingLevel: next,
        enableThinking: next !== 'off',
      } as Record<string, unknown>);
    } catch {
      // Silent — user can retry; UI already reflects the optimistic state.
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 px-2 py-1 rounded-md hover:bg-surface-hover transition-colors ${LEVEL_COLORS[level]}`}
        title={t('reasoning.pickerTooltip', 'Reasoning level')}
        data-testid="reasoning-level-picker"
      >
        <Brain className="w-3.5 h-3.5" />
        <span className="text-[10px] font-medium uppercase tracking-wide">{level}</span>
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 bg-surface border border-border rounded-lg shadow-lg overflow-hidden min-w-[140px]">
          {LEVELS.map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => applyLevel(lvl)}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-hover transition-colors flex items-center justify-between ${
                lvl === level ? 'bg-surface-active' : ''
              }`}
              data-testid={`reasoning-level-option-${lvl}`}
            >
              <span className={`uppercase font-medium ${LEVEL_COLORS[lvl]}`}>{lvl}</span>
              {lvl === level && <span className="text-[10px] text-text-muted">●</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
