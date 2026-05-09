/**
 * ApprovalDialog — modal that surfaces a pending workflow approval and
 * forwards the user's answer back to the bridge via `workflow.approve`.
 *
 * Driven by `state.pendingApprovals[0]` from the app store: as soon as
 * the bridge emits `workflow.approval_required`, the head of the queue
 * pops up. Approving or rejecting calls the IPC bridge and removes the
 * entry from the local queue.
 *
 * @module cowork/renderer/components/ApprovalDialog
 */

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, XCircle, Clock, AlertTriangle, Wrench } from 'lucide-react';
import { useAppStore } from '../store';

/**
 * Heuristic detector for approval payloads that look destructive
 * enough to warrant a red warning banner. Pattern-matches the tool
 * input string representation against known-risky shapes (rm -rf,
 * chmod 777, eval, format /, …).
 */
function looksDestructive(toolName: string | undefined, toolInput: Record<string, unknown> | undefined): { warning: string | null } {
  if (!toolInput && !toolName) return { warning: null };
  const blob = `${toolName ?? ''} ${JSON.stringify(toolInput ?? {})}`.toLowerCase();
  const patterns: Array<{ re: RegExp; reason: string }> = [
    { re: /rm\s+-[rRf]+\s/, reason: 'recursive/forced rm' },
    { re: /chmod\s+(?:0?7?77|a\+\w*x)/, reason: 'overly permissive chmod' },
    { re: /\beval\s*\(/, reason: 'eval()' },
    { re: /sudo\s+/, reason: 'sudo escalation' },
    { re: /format\s+\w*:|mkfs\.|fdisk/, reason: 'disk format' },
    { re: /:\(\)\s*\{[^}]*:\|:&\}/, reason: 'fork bomb' },
    { re: /curl[^|]*\|\s*(?:bash|sh)\b/, reason: 'piped curl|bash' },
    { re: /wget[^|]*\|\s*(?:bash|sh)\b/, reason: 'piped wget|bash' },
    { re: /\bdrop\s+(?:database|table)\b/, reason: 'DROP DATABASE/TABLE' },
    { re: /git\s+push\s+--force/, reason: 'git push --force' },
  ];
  for (const { re, reason } of patterns) {
    if (re.test(blob)) return { warning: reason };
  }
  return { warning: null };
}

export const ApprovalDialog: React.FC = () => {
  const pending = useAppStore((s) => s.pendingApprovals);
  const remove = useAppStore((s) => s.removePendingApproval);

  const head = pending[0] ?? null;
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Tick every second so the countdown stays accurate.
  useEffect(() => {
    if (!head) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [head]);

  // Hooks above must be called unconditionally — declare the destructive
  // hint before the early return.
  const destructive = useMemo(
    () => looksDestructive(head?.payload?.toolName, head?.payload?.toolInput),
    [head?.payload?.toolName, head?.payload?.toolInput]
  );

  if (!head) return null;

  const remainingMs = head.expiresAt ? Math.max(0, head.expiresAt - now) : null;
  const remainingLabel =
    remainingMs !== null ? `${Math.ceil(remainingMs / 1000)}s` : '—';
  const inputJson = head.payload?.toolInput
    ? JSON.stringify(head.payload.toolInput, null, 2)
    : null;

  const reply = async (approved: boolean) => {
    setSubmitting(true);
    try {
      await window.electronAPI.workflow.approve(head.stepId, approved);
    } finally {
      setSubmitting(false);
      remove(head.stepId);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-[480px] max-w-[92vw] max-h-[85vh] bg-background border border-border rounded-xl shadow-elevated p-5 space-y-4 overflow-y-auto">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            Workflow approval required
          </h3>
          <p className="text-xs text-text-muted mt-1 break-words">
            {head.message || 'Approve to continue the workflow.'}
          </p>
        </div>

        {/* Destructive-pattern warning */}
        {destructive.warning && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-error/10 border border-error/40 text-error">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <div className="text-xs">
              <div className="font-semibold">Destructive pattern detected: {destructive.warning}</div>
              <div className="text-error/80 mt-0.5">Re-read the tool input below before approving.</div>
            </div>
          </div>
        )}

        {/* Tool preview */}
        {head.payload?.toolName && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-muted">
              <Wrench size={11} />
              <span>About to invoke</span>
            </div>
            <div className="text-xs font-mono text-text-primary px-2 py-1 rounded bg-surface border border-border-muted">
              {head.payload.toolName}
            </div>
            {inputJson && (
              <pre className="text-[11px] font-mono whitespace-pre-wrap break-words rounded bg-surface px-2 py-2 max-h-48 overflow-y-auto text-text-secondary border border-border-muted">
                {inputJson}
              </pre>
            )}
          </div>
        )}

        {head.expiresAt && (
          <div className="flex items-center gap-1 text-[11px] text-text-muted">
            <Clock size={11} />
            <span>auto-rejects in {remainingLabel}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            disabled={submitting}
            onClick={() => void reply(false)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-surface border border-border text-text-secondary hover:bg-surface-hover disabled:opacity-50 transition-colors"
          >
            <XCircle size={12} />
            Reject
          </button>
          <button
            disabled={submitting}
            onClick={() => void reply(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            <CheckCircle2 size={12} />
            Approve
          </button>
        </div>

        {pending.length > 1 && (
          <div className="text-[10px] text-text-muted">
            {pending.length - 1} more approval(s) queued
          </div>
        )}
      </div>
    </div>
  );
};
