import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useIPC } from '../hooks/useIPC';
import type { SudoPasswordRequest } from '../types';
import { Shield, X, Play } from 'lucide-react';

interface SudoPasswordDialogProps {
  request: SudoPasswordRequest;
}

export function SudoPasswordDialog({ request }: SudoPasswordDialogProps) {
  const { t } = useTranslation();
  const { respondToSudoPassword } = useIPC();
  // Use ref so the password never lives in React state / re-render cycle
  const passwordRef = useRef<string>('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Capture ref values for safe use in cleanup
    const inputEl = inputRef.current;
    // Clear the password from memory when the dialog unmounts
    return () => {
      passwordRef.current = '';
      if (inputEl) {
        inputEl.value = '';
      }
    };
  }, []);

  const handleSubmit = () => {
    const pwd = passwordRef.current;
    if (!pwd) return;
    respondToSudoPassword(request.toolUseId, pwd);
    // Wipe immediately after sending
    passwordRef.current = '';
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleCancel = () => {
    respondToSudoPassword(request.toolUseId, null);
    passwordRef.current = '';
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Modal keyboard handling: Escape cancels from anywhere in the dialog, and
  // Tab is trapped so keyboard/screen-reader focus can't wander behind the
  // password modal.
  const handleDialogKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sudo-dialog-title"
        onKeyDown={handleDialogKeyDown}
        className="card w-full max-w-md p-6 m-4 shadow-elevated animate-slide-up"
      >
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-warning/10">
            <Shield className="w-6 h-6 text-warning" />
          </div>

          <div className="flex-1">
            <h2 id="sudo-dialog-title" className="text-lg font-semibold text-text-primary">
              {t('sudo.title')}
            </h2>
            <p className="text-sm text-text-secondary mt-1">{t('sudo.description')}</p>
          </div>
        </div>

        {/* Command display */}
        <div className="mt-4 p-4 bg-surface-muted rounded-xl">
          <pre className="text-xs code-block max-h-32 overflow-auto whitespace-pre-wrap break-all">
            {request.command}
          </pre>
        </div>

        {/* Password input */}
        <div className="mt-4">
          <label className="block text-sm font-medium text-text-primary mb-1">
            {t('sudo.passwordLabel')}
          </label>
          <input
            ref={inputRef}
            type="password"
            onChange={(e) => {
              passwordRef.current = e.target.value;
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={t('sudo.passwordPlaceholder')}
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
            autoComplete="new-password"
          />
        </div>

        {/* Warning */}
        <div className="mt-3 p-3 bg-warning/10 border border-warning/20 rounded-xl">
          <p className="text-xs text-warning">{t('sudo.warning')}</p>
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center gap-3">
          <button onClick={handleCancel} className="flex-1 btn btn-secondary">
            <X className="w-4 h-4" />
            {t('sudo.cancel')}
          </button>

          <button onClick={handleSubmit} className="flex-1 btn btn-primary">
            <Play className="w-4 h-4" />
            {t('sudo.execute')}
          </button>
        </div>
      </div>
    </div>
  );
}
