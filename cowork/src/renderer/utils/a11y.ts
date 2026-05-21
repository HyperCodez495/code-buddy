/**
 * a11y — P5.4
 *
 * Helpers to enforce baseline accessibility on dialogs and overlays.
 *
 * Usage:
 *   const dialogProps = dialogA11yProps('My dialog');
 *   <div {...dialogProps}>...</div>
 */

export interface DialogA11yProps {
  role: 'dialog';
  'aria-modal': 'true';
  'aria-label': string;
  tabIndex: -1;
}

export function dialogA11yProps(label: string): DialogA11yProps {
  return {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': label,
    tabIndex: -1,
  };
}

/** Trap focus inside a container for Tab and Shift+Tab navigation. */
export function trapFocus(container: HTMLElement): () => void {
  const focusable = container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  function handler(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last?.focus();
      }
    } else {
      if (active === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  }

  container.addEventListener('keydown', handler);
  first?.focus();
  return () => container.removeEventListener('keydown', handler);
}

/** Detects whether the user prefers reduced motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}
