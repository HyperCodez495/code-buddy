/**
 * PermissionModeSelector — Dropdown to switch between permission modes
 *
 * Matches Native Engine's Default/AcceptEdits/Plan/DontAsk modes.
 */
import React, { useState, useRef, useEffect } from 'react';
import { Shield, ShieldCheck, ShieldOff, Eye, Zap } from 'lucide-react';
import type { PermissionMode } from '../types';

interface PermissionModeSelectorProps {
  currentMode: PermissionMode;
  onModeChange: (mode: PermissionMode) => void;
}

const modeConfig: Array<{
  mode: PermissionMode;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}> = [
  {
    mode: 'default',
    label: 'Default',
    description: 'Ask for edits and commands',
    icon: <Shield size={14} />,
    color: 'text-blue-400',
  },
  {
    mode: 'acceptEdits',
    label: 'Accept Edits',
    description: 'Auto-approve file edits',
    icon: <ShieldCheck size={14} />,
    color: 'text-green-400',
  },
  {
    mode: 'plan',
    label: 'Plan Mode',
    description: 'Read-only research',
    icon: <Eye size={14} />,
    color: 'text-yellow-400',
  },
  {
    mode: 'dontAsk',
    label: "Don't Ask",
    description: 'Auto-approve everything',
    icon: <Zap size={14} />,
    color: 'text-orange-400',
  },
  {
    mode: 'bypassPermissions',
    label: 'Full Auto',
    description: 'No restrictions',
    icon: <ShieldOff size={14} />,
    color: 'text-red-400',
  },
];

export const PermissionModeSelector: React.FC<PermissionModeSelectorProps> = ({
  currentMode,
  onModeChange,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = modeConfig.find((m) => m.mode === currentMode) || modeConfig[0];

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${current.color} bg-surface hover:bg-surface-hover transition-colors`}
        title={`Permission: ${current.label}`}
      >
        {current.icon}
        <span className="hidden sm:inline">{current.label}</span>
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 w-56 bg-surface border border-border rounded-lg shadow-xl z-50 overflow-hidden">
          {modeConfig.map((item) => (
            <button
              key={item.mode}
              onClick={() => {
                onModeChange(item.mode);
                setOpen(false);
              }}
              className={`w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-surface-hover transition-colors ${
                item.mode === currentMode ? 'bg-zinc-700/50' : ''
              }`}
            >
              <span className={`mt-0.5 ${item.color}`}>{item.icon}</span>
              <div>
                <div className={`text-xs font-medium ${item.color}`}>{item.label}</div>
                <div className="text-xs text-muted-foreground">{item.description}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
