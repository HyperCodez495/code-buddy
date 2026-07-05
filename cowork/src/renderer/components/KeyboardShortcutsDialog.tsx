/**
 * KeyboardShortcutsDialog — Modal listing every keyboard shortcut Cowork
 * registers. Sourced from:
 *   - cowork/src/renderer/App.tsx (19 mod / mod+shift bindings)
 *   - cowork/src/renderer/components/TabBar.tsx (Cmd+1..9 tab switching)
 *   - Per-component Escape close handlers (ActivityFeed, FocusView, …)
 *   - cowork/src/main/index.ts (Cmd+Alt+S panic stop, registered globally)
 *   - cowork/src/main/window-management.ts (macOS menu accelerators)
 *
 * Keep this file in sync when a shortcut is added — the dialog is the
 * canonical user-facing reference. The header search filters across all
 * sections, so users can `Cmd+/` then type "snip" to find Cmd+Shift+S.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Search } from 'lucide-react';

interface KeyboardShortcutsDialogProps {
  onClose: () => void;
}

interface ShortcutEntry {
  keys: string;
  description: string;
}

interface ShortcutSection {
  title: string;
  shortcuts: ShortcutEntry[];
}

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl';
const opt = isMac ? '⌥' : 'Alt';
const shift = isMac ? '⇧' : 'Shift';

export const KeyboardShortcutsDialog: React.FC<KeyboardShortcutsDialogProps> = ({ onClose }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sections: ShortcutSection[] = useMemo(
    () => [
      {
        title: t('shortcutsDialog.general', 'General'),
        shortcuts: [
          { keys: `${mod}+K`, description: t('shortcutsDialog.openCommandPalette', 'Open command palette') },
          { keys: `${mod}+P`, description: t('shortcutsDialog.openGlobalSearch', 'Open global search') },
          { keys: `${mod}+/`, description: t('shortcutsDialog.showKeyboardShortcuts', 'Show keyboard shortcuts (this dialog)') },
          { keys: `${mod}+,`, description: t('shortcutsDialog.openSettings', 'Open settings') },
          { keys: `${mod}+F`, description: t('shortcutsDialog.searchMessages', 'Search in active session') },
          { keys: 'Escape', description: t('shortcutsDialog.closeOpenDialog', 'Close the topmost dialog / panel') },
        ],
      },
      {
        title: t('shortcutsDialog.layout', 'Layout & navigation'),
        shortcuts: [
          { keys: `${mod}+B`, description: t('shortcutsDialog.toggleSidebar', 'Toggle sidebar') },
          { keys: `${mod}+\\`, description: t('shortcutsDialog.toggleSplitPane', 'Toggle split-pane layout') },
          { keys: `${mod}+1..9`, description: t('shortcutsDialog.switchTab', 'Switch to tab 1..9') },
        ],
      },
      {
        title: t('shortcutsDialog.chat', 'Chat input'),
        shortcuts: [
          { keys: 'Enter', description: t('shortcutsDialog.sendMessage', 'Send message') },
          { keys: `${shift}+Enter`, description: t('shortcutsDialog.newLine', 'New line in the message') },
          { keys: 'Escape', description: t('shortcutsDialog.stopGeneration', 'Cancel a running response (when chat focused)') },
        ],
      },
      {
        title: t('shortcutsDialog.panels', 'Panels & overlays'),
        shortcuts: [
          { keys: `${mod}+${shift}+K`, description: t('shortcutsDialog.toggleGlobalSearch', 'Toggle global search overlay') },
          { keys: `${mod}+${shift}+S`, description: t('shortcutsDialog.openSnippets', 'Open snippets library') },
          { keys: `${mod}+${shift}+P`, description: t('shortcutsDialog.openPersonaSwitcher', 'Open persona switcher') },
          { keys: `${mod}+${shift}+T`, description: t('shortcutsDialog.openTestRunner', 'Open test runner panel') },
          { keys: `${mod}+${shift}+R`, description: t('shortcutsDialog.openReasoning', 'Open reasoning-trace viewer') },
          { keys: `${mod}+${shift}+I`, description: t('shortcutsDialog.openSessionInsights', 'Open session insights') },
          { keys: `${mod}+${shift}+O`, description: t('shortcutsDialog.openResumeChooser', 'Open session resume chooser') },
          { keys: `${mod}+${shift}+F`, description: t('shortcutsDialog.openFocusView', 'Toggle focus view') },
        ],
      },
      {
        title: t('shortcutsDialog.multiAgent', 'Multi-agent & workflow'),
        shortcuts: [
          { keys: `${mod}+${shift}+M`, description: t('shortcutsDialog.openOrchestratorLauncher', 'Open multi-agent orchestrator launcher') },
          { keys: `${mod}+${shift}+A`, description: t('shortcutsDialog.openSubAgentDashboard', 'Open sub-agent dashboard') },
        ],
      },
      {
        title: t('shortcutsDialog.diagnostics', 'Diagnostics & one-shots'),
        shortcuts: [
          { keys: `${mod}+${shift}+D`, description: t('shortcutsDialog.openDiagnostics', 'Open security diagnostics (vulns/secrets/licenses)') },
          { keys: `${mod}+${shift}+/`, description: t('shortcutsDialog.btwQuickAsk', 'One-shot quick question (BTW)') },
        ],
      },
      {
        title: t('shortcutsDialog.power', 'Power-user'),
        shortcuts: [
          { keys: `${mod}+${opt}+S`, description: t('shortcutsDialog.panicStop', 'Panic-stop the active agent (global)') },
          { keys: `${mod}+R`, description: t('shortcutsDialog.reloadRenderer', 'Reload the renderer (Electron default)') },
          { keys: `${mod}+${shift}+I`, description: t('shortcutsDialog.toggleDevtools', 'Toggle DevTools (in dev builds)') },
        ],
      },
    ],
    [t]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sections;
    return sections
      .map((section) => ({
        ...section,
        shortcuts: section.shortcuts.filter(
          (sc) =>
            sc.keys.toLowerCase().includes(q) || sc.description.toLowerCase().includes(q)
        ),
      }))
      .filter((section) => section.shortcuts.length > 0);
  }, [sections, query]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('shortcutsDialog.title', 'Keyboard shortcuts')}
    >
      <div
        className="w-[640px] max-w-[92vw] max-h-[85vh] bg-background border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-medium text-secondary">
            {t('shortcutsDialog.title', 'Keyboard shortcuts')}
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-secondary transition-colors"
            aria-label={t('common.close', 'Close')}
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-border shrink-0">
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('shortcutsDialog.searchPlaceholder', 'Search shortcuts…')}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-800/60 border border-border rounded-md text-secondary placeholder:text-muted-foreground focus:outline-none focus:border-zinc-500"
            />
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-5 space-y-5 flex-1">
          {filtered.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-8">
              {t('shortcutsDialog.noMatches', 'No shortcut matches your search.')}
            </div>
          ) : (
            filtered.map((section) => (
              <div key={section.title}>
                <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  {section.title}
                </h3>
                <div className="space-y-0.5">
                  {section.shortcuts.map((shortcut) => (
                    <div
                      key={shortcut.keys + shortcut.description}
                      className="flex items-center justify-between gap-3 py-1.5 px-2 rounded hover:bg-zinc-800/40 transition-colors"
                    >
                      <span className="text-sm text-secondary flex-1 min-w-0">
                        {shortcut.description}
                      </span>
                      <ShortcutKey keys={shortcut.keys} />
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-border text-[10px] text-muted-foreground shrink-0 flex items-center justify-between">
          <span>
            {t('shortcutsDialog.footerHint', 'Press {{shortcut}} anywhere to reopen this dialog.', { shortcut: `${mod}+/` })}
          </span>
          <span className="text-muted-foreground">
            {filtered.reduce((acc, s) => acc + s.shortcuts.length, 0)}{' '}
            {t('shortcutsDialog.results', 'results')}
          </span>
        </div>
      </div>
    </div>
  );
};

/** Renders a key combination as a row of `<kbd>` boxes. */
const ShortcutKey: React.FC<{ keys: string }> = ({ keys }) => {
  const parts = keys.split('+').map((p) => p.trim()).filter(Boolean);
  return (
    <span className="flex items-center gap-1 shrink-0">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-muted-foreground text-xs">+</span>}
          <kbd className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-surface border border-border text-secondary min-w-[20px] text-center">
            {part}
          </kbd>
        </React.Fragment>
      ))}
    </span>
  );
};
