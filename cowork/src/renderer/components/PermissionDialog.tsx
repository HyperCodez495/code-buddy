import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useIPC } from '../hooks/useIPC';
import { usePermissionRuleAssist } from '../hooks/usePermissionRuleAssist';
import type { PermissionRequest } from '../types';
import { Shield, X, Check, AlertTriangle, Monitor } from 'lucide-react';
import { useAppStore } from '../store';
import { PermissionRuleAssistPanel } from './PermissionRuleAssistPanel';

interface PermissionDialogProps {
  permission: PermissionRequest;
}

export function PermissionDialog({ permission }: PermissionDialogProps) {
  const { t } = useTranslation();
  const { respondToPermission } = useIPC();
  const [pendingAlwaysAllow, setPendingAlwaysAllow] = useState(false);
  // Two-step deny (Hermes /deny parity): first click reveals an optional
  // reason field; the reason travels back to the agent as feedback.
  const [denyMode, setDenyMode] = useState(false);
  const [denyReason, setDenyReason] = useState('');
  const guiActions = useAppStore((s) => s.guiActions);
  const setShowComputerUseOverlay = useAppStore((s) => s.setShowComputerUseOverlay);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const setSettingsTab = useAppStore((s) => s.setSettingsTab);
  const setPermissionRuleTestDraft = useAppStore((s) => s.setPermissionRuleTestDraft);
  const setPermissionRuleDraft = useAppStore((s) => s.setPermissionRuleDraft);

  const modalRef = useRef<HTMLDivElement>(null);

  // Focus trap
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        if (!modalRef.current) return;
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            lastElement.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === lastElement) {
            firstElement.focus();
            e.preventDefault();
          }
        }
      } else if (e.key === 'Escape') {
        respondToPermission(permission.toolUseId, 'deny');
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [permission.toolUseId, respondToPermission]);

  // Initial focus
  useEffect(() => {
    if (modalRef.current) {
      const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusableElements.length > 0) {
        setTimeout(() => focusableElements[0].focus(), 100);
      }
    }
  }, []);

  const getToolDescription = (toolName: string): string => {
    const key = `permission.toolDescriptions.${toolName}`;
    const translated = t(key);
    // If translation exists (not the same as key), return it
    if (translated !== key) {
      return translated;
    }
    // Otherwise fallback to default message
    return t('permission.useTool', { toolName });
  };

  const isHighRisk = [
    'bash',
    'write',
    'edit',
    'execute_command',
    'write_file',
    'edit_file',
  ].includes(permission.toolName);

  const relatedGuiAction = [...guiActions]
    .reverse()
    .find(
      (action) =>
        action.toolUseId === permission.toolUseId ||
        (action.sessionId === permission.sessionId &&
          Date.now() - action.timestamp < 60_000 &&
          action.toolName === permission.toolName)
    );

  const isComputerUsePermission =
    Boolean(relatedGuiAction) ||
    /gui|computer|chrome|screenshot/i.test(permission.toolName || '');

  const screenshotSrc = relatedGuiAction?.screenshot?.startsWith('data:')
    ? relatedGuiAction.screenshot
    : relatedGuiAction?.screenshot
      ? `file://${relatedGuiAction.screenshot.replace(/\\/g, '/')}`
      : undefined;

  const computerUseSummary = (() => {
    if (!relatedGuiAction) return '';
    const detailObj = relatedGuiAction.details || {};
    const url = typeof detailObj.url === 'string' ? detailObj.url : '';
    const text = typeof detailObj.text === 'string' ? detailObj.text : '';
    const app = typeof detailObj.app === 'string' ? detailObj.app : '';
    const target = typeof detailObj.target === 'string' ? detailObj.target : '';
    return [app, target, url, text].filter(Boolean).join(' • ');
  })();

  const {
    derivedFolderRule,
    derivedReviewRule,
    derivedScopedRule,
    handleSaveScopedRule,
    hasCoveredSuggestionNote,
    isScopedRuleDraftValid,
    matchedDecision,
    normalizedScopedRuleDraft,
    openRulesReview,
    rulePreview,
    rulePreviewTone,
    savingScopedTargetDecision,
    scopedRuleDraft,
    setScopedRuleDraft,
    showRuleDraftPanel,
    showScopedRuleSuggestion,
  } = usePermissionRuleAssist({
    permission,
    relatedDetails: relatedGuiAction?.details,
    activeProjectId,
    setShowSettings,
    setSettingsTab,
    setPermissionRuleTestDraft,
    setPermissionRuleDraft,
    respondToPermission,
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50"
      data-testid="permission-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="permission-dialog-title"
    >
      <motion.div
        ref={modalRef}
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="card w-full max-w-md p-6 m-4 shadow-elevated"
      >
        {/* Header */}
        <div className="flex items-start gap-4">
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
              isHighRisk ? 'bg-warning/10' : 'bg-accent-muted'
            }`}
          >
            {isHighRisk ? (
              <AlertTriangle className="w-6 h-6 text-warning" />
            ) : isComputerUsePermission ? (
              <Monitor className="w-6 h-6 text-accent" />
            ) : (
              <Shield className="w-6 h-6 text-accent" />
            )}
          </div>

          <div className="flex-1">
            <h2 id="permission-dialog-title" className="text-lg font-semibold text-text-primary">
              {t('permission.permissionRequired')}
            </h2>
            <p className="text-sm text-text-secondary mt-1">
              {getToolDescription(permission.toolName)}
            </p>
          </div>
        </div>

        {isComputerUsePermission && (
          <div className="mt-4 space-y-3">
            <div className="p-4 bg-surface-muted rounded-xl">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  <Monitor className="w-4 h-4 text-accent" />
                  {t('permission.computerUseTitle', 'Computer use context')}
                </div>
                <button
                  type="button"
                  onClick={() => setShowComputerUseOverlay(true)}
                  className="text-xs text-accent hover:text-accent-hover"
                >
                  {t('permission.openComputerUseOverlay', 'Open overlay')}
                </button>
              </div>
              {computerUseSummary && (
                <div className="text-xs text-text-secondary mb-2">{computerUseSummary}</div>
              )}
              {relatedGuiAction?.click && (
                <div className="text-[11px] text-text-muted mb-2">
                  {t('permission.computerUseClickAt', {
                    x: relatedGuiAction.click.x,
                    y: relatedGuiAction.click.y,
                  })}
                </div>
              )}
              {screenshotSrc ? (
                <div className="rounded-lg overflow-hidden border border-border bg-background max-h-52">
                  <img
                    src={screenshotSrc}
                    alt="computer-use-preview"
                    className="w-full h-auto max-h-52 object-contain"
                  />
                </div>
              ) : (
                <div className="text-xs text-text-muted">
                  {t('permission.computerUseNoScreenshot', 'No screenshot available for this action')}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tool Details */}
        <div className="mt-4 p-4 bg-surface-muted rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-medium text-text-primary">{t('permission.tool')}</span>
            <span className="font-mono text-accent text-sm">{permission.toolName}</span>
          </div>

          <div className="text-sm text-text-secondary">
            <span className="font-medium text-text-primary">{t('permission.input')}</span>
            <pre className="mt-1 text-xs code-block max-h-32 overflow-auto">
              {JSON.stringify(permission.input, null, 2)}
            </pre>
          </div>
        </div>

        <PermissionRuleAssistPanel
          t={t}
          rulePreviewTone={rulePreviewTone}
          rulePreview={rulePreview}
          derivedScopedRule={derivedScopedRule}
          derivedReviewRule={derivedReviewRule}
          derivedFolderRule={derivedFolderRule}
          scopedRuleDraft={scopedRuleDraft}
          normalizedScopedRuleDraft={normalizedScopedRuleDraft}
          isScopedRuleDraftValid={isScopedRuleDraftValid}
          showScopedRuleSuggestion={showScopedRuleSuggestion}
          hasCoveredSuggestionNote={hasCoveredSuggestionNote}
          showRuleDraftPanel={showRuleDraftPanel}
          matchedDecision={matchedDecision}
          savingScopedTargetDecision={savingScopedTargetDecision}
          onChangeScopedRuleDraft={setScopedRuleDraft}
          onUseFolderRule={() => setScopedRuleDraft(derivedFolderRule ?? '')}
          onUseSuggestedRule={() => setScopedRuleDraft(derivedScopedRule ?? '')}
          onSaveScopedRule={handleSaveScopedRule}
          onOpenRulesReview={openRulesReview}
        />

        {/* Warning */}
        {isHighRisk && (
          <div className="mt-4 p-3 bg-warning/10 border border-warning/20 rounded-xl">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
              <p className="text-sm text-warning">{t('permission.warning')}</p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex items-center gap-3">
          {denyMode ? (
            <div className="flex-1 flex items-center gap-2" data-testid="permission-deny-reason-row">
              <input
                autoFocus
                type="text"
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    respondToPermission(permission.toolUseId, 'deny', denyReason.trim() || undefined);
                  }
                }}
                placeholder="Pourquoi ? (optionnel — l'agent le lira)"
                className="flex-1 rounded-md border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:border-accent"
                data-testid="permission-deny-reason-input"
              />
              <button
                onClick={() => respondToPermission(permission.toolUseId, 'deny', denyReason.trim() || undefined)}
                className="btn btn-secondary"
                data-testid="permission-deny-confirm-button"
              >
                <X className="w-4 h-4" />
                {t('permission.deny')}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setDenyMode(true)}
              className="flex-1 btn btn-secondary"
              data-testid="permission-deny-button"
            >
              <X className="w-4 h-4" />
              {t('permission.deny')}
            </button>
          )}

          <button
            onClick={() => respondToPermission(permission.toolUseId, 'allow')}
            className="flex-1 btn btn-primary"
            data-testid="permission-allow-button"
          >
            <Check className="w-4 h-4" />
            {t('permission.allow')}
          </button>
        </div>

        {/* Always Allow option */}
        {!pendingAlwaysAllow ? (
          <button
            onClick={() => {
              const dangerousTools = ['bash', 'write', 'edit', 'execute_command'];
              const isDangerous = dangerousTools.some((tool) =>
                permission.toolName?.toLowerCase().includes(tool)
              );
              if (isDangerous) {
                setPendingAlwaysAllow(true);
              } else {
                respondToPermission(permission.toolUseId, 'allow_always');
              }
            }}
            className="w-full mt-2 btn btn-ghost text-sm"
          >
            {t('permission.alwaysAllow')}
          </button>
        ) : (
          <div className="mt-2 p-3 bg-warning/10 border border-warning/20 rounded-xl">
            <p className="text-sm text-warning mb-2">
              {`Are you sure you want to always allow "${permission.toolName}"? This tool can modify your system.`}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPendingAlwaysAllow(false)}
                className="flex-1 btn btn-secondary text-sm"
              >
                {t('permission.deny')}
              </button>
              <button
                onClick={() => {
                  setPendingAlwaysAllow(false);
                  respondToPermission(permission.toolUseId, 'allow_always');
                }}
                className="flex-1 btn btn-primary text-sm"
              >
                {t('permission.alwaysAllow')}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
