/**
 * BrowserOperatorOverlay — S2 (Browser Operator pilotability)
 *
 * Floating, retractable panel that shows the live browser-automation action log
 * executed by the agent (navigate / click / type / extract / screenshot …),
 * with the latest page screenshot when available and a panic STOP control.
 *
 * Auto-opens when a `browser.action` event arrives (store.appendBrowserAction).
 * Mirrors ComputerUseOverlay but for the browser tool; positioned bottom-LEFT so
 * the two operator overlays don't overlap.
 *
 * @module renderer/components/BrowserOperatorOverlay
 */

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, X, Minimize2, Maximize2, StopCircle } from 'lucide-react';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';

export const BrowserOperatorOverlay: React.FC = () => {
  const { t } = useTranslation();
  const { stopSession } = useIPC();
  const browserActions = useAppStore((s) => s.browserActions);
  const show = useAppStore((s) => s.showBrowserOperatorOverlay);
  const setShow = useAppStore((s) => s.setShowBrowserOperatorOverlay);
  const activeSessionId = useAppStore((s) => s.activeSessionId);

  const [minimized, setMinimized] = useState(false);

  const sessionActions = useMemo(() => {
    if (!activeSessionId) return browserActions;
    return browserActions.filter((a) => a.sessionId === activeSessionId);
  }, [browserActions, activeSessionId]);

  if (!show || sessionActions.length === 0) return null;

  const latest = sessionActions[sessionActions.length - 1];
  const screenshotSrc = latest?.screenshot?.startsWith('data:')
    ? latest.screenshot
    : latest?.screenshot
      ? `file://${latest.screenshot.replace(/\\/g, '/')}`
      : undefined;

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="fixed bottom-4 left-4 z-40 flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-lg shadow-elevated hover:bg-surface-hover transition-colors"
        title={t('browserOperator.expand', { defaultValue: 'Expand browser operator' })}
      >
        <Globe size={14} className="text-accent" />
        <span className="text-xs text-text-primary">
          {t('browserOperator.minimized', {
            count: sessionActions.length,
            defaultValue: `${sessionActions.length} browser actions`,
          })}
        </span>
        <Maximize2 size={12} className="text-text-muted" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-40 w-[420px] max-w-[90vw] bg-background border border-border rounded-xl shadow-elevated flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-muted shrink-0">
        <div className="flex items-center gap-2">
          <Globe size={14} className="text-accent" />
          <span className="text-xs font-semibold text-text-primary">
            {t('browserOperator.title', { defaultValue: 'Browser Operator' })}
          </span>
          <span className="text-[10px] text-text-muted">
            {t('browserOperator.count', {
              count: sessionActions.length,
              defaultValue: `${sessionActions.length} actions`,
            })}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              if (activeSessionId) stopSession(activeSessionId);
            }}
            className="flex items-center gap-1 px-2 py-0.5 bg-red-500 hover:bg-red-600 text-white rounded transition-colors mr-2 shadow-sm"
            title={t('browserOperator.panicStop', { defaultValue: 'Stop Agent Immediately' })}
          >
            <StopCircle size={10} strokeWidth={3} />
            <span className="text-[9px] font-black tracking-wider">STOP</span>
          </button>
          <button
            onClick={() => setMinimized(true)}
            className="p-1 text-text-muted hover:text-text-primary transition-colors"
            title={t('common.minimize', { defaultValue: 'Minimize' })}
          >
            <Minimize2 size={12} />
          </button>
          <button
            onClick={() => setShow(false)}
            className="p-1 text-text-muted hover:text-text-primary transition-colors"
            title={t('common.close')}
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Latest screenshot (if any) */}
      {screenshotSrc && (
        <div className="relative bg-surface/50 border-b border-border-muted max-h-[240px] overflow-auto flex items-center justify-center">
          <img src={screenshotSrc} alt="browser-screenshot" className="max-w-full max-h-[240px] block" />
        </div>
      )}

      {/* Live action log (latest last) */}
      <div className="max-h-[260px] overflow-y-auto divide-y divide-border-muted/60">
        {sessionActions.map((a, idx) => (
          <div key={`${a.toolUseId}-${idx}`} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide font-semibold text-accent">
                {a.action}
              </span>
              {a.url && (
                <span className="text-[10px] text-text-muted truncate" title={a.url}>
                  {a.url}
                </span>
              )}
            </div>
            {a.target && (
              <div className="text-[10px] text-text-muted mt-0.5 truncate" title={a.target}>
                → {a.target}
              </div>
            )}
            {a.evidence && (
              <div className="text-[10px] text-text-muted/80 mt-0.5 line-clamp-2">{a.evidence}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
