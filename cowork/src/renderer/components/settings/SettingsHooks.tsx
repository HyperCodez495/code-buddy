/**
 * SettingsHooks — Claude Cowork parity Phase 3 step 13
 *
 * Visual editor for `.codebuddy/hooks.json`. Lists configured hooks
 * grouped by event (PreToolUse, PostToolUse, SessionStart, …), edits
 * individual handlers (command / http / prompt / agent), and provides
 * a dry-run Test button for command handlers to catch issues before
 * they fire at runtime.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Save, Trash2, Play, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';

const HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'Stop',
  'StopFailure',
  'FileChanged',
  'PreCompact',
  'PostCompact',
  'SubagentStart',
  'SubagentStop',
  'TaskCreated',
  'TaskCompleted',
] as const;

type HookEvent = (typeof HOOK_EVENTS)[number];
type HandlerType = 'command' | 'http' | 'prompt' | 'agent';

interface HookHandler {
  type: HandlerType;
  command?: string;
  url?: string;
  prompt?: string;
  if?: string;
  timeout?: number;
}

interface HookEntry {
  id: string;
  event: HookEvent;
  index: number;
  handler: HookHandler;
}

interface TestResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  error?: string;
}

const EMPTY_DRAFT: HookHandler = {
  type: 'command',
  command: '',
  if: '',
  timeout: 10000,
};

export function SettingsHooks() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<HookEntry[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<HookEvent>('PreToolUse');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<HookHandler>(EMPTY_DRAFT);
  const [isLoading, setIsLoading] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!window.electronAPI?.hooks?.list) return;
    setIsLoading(true);
    try {
      const list = (await window.electronAPI.hooks.list()) as HookEntry[];
      setEntries(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const newHandler = () => {
    setEditingIndex(null);
    setDraft({ ...EMPTY_DRAFT });
    setTestResult(null);
  };

  const editHandler = (entry: HookEntry) => {
    setSelectedEvent(entry.event);
    setEditingIndex(entry.index);
    setDraft({ ...entry.handler });
    setTestResult(null);
  };

  const handleSave = async () => {
    if (!window.electronAPI?.hooks?.upsert) return;
    setError(null);
    try {
      const result = await window.electronAPI.hooks.upsert({
        event: selectedEvent,
        handler: draft as unknown as Record<string, unknown>,
        index: editingIndex ?? undefined,
      });
      if (!result.success) {
        setError(result.error ?? 'Save failed');
        return;
      }
      setNotice(t('hooks.saved', 'Hook saved'));
      setTimeout(() => setNotice(null), 2000);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (entry: HookEntry) => {
    if (!window.electronAPI?.hooks?.remove) return;
    if (!window.confirm(t('hooks.deleteConfirm', 'Delete this hook?'))) return;
    try {
      await window.electronAPI.hooks.remove({ event: entry.event, index: entry.index });
      if (editingIndex === entry.index && selectedEvent === entry.event) {
        setEditingIndex(null);
        setDraft({ ...EMPTY_DRAFT });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleTest = async () => {
    if (!window.electronAPI?.hooks?.test) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await window.electronAPI.hooks.test(draft as unknown as Record<string, unknown>);
      setTestResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            {t('hooks.title', 'Hooks & triggers')}
          </h3>
          <p className="text-xs text-text-muted mt-1">
            {t(
              'hooks.hint',
              'Run shell commands or HTTP calls on agent lifecycle events. Stored in .codebuddy/hooks.json.'
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            disabled={isLoading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-surface border border-border text-text-primary hover:bg-surface-hover disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
            {t('common.refresh', 'Refresh')}
          </button>
          <button
            onClick={newHandler}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            <Plus size={12} />
            {t('hooks.new', 'New hook')}
          </button>
        </div>
      </div>

      {notice && (
        <div className="flex items-center gap-2 text-xs text-success bg-success/10 border border-success/30 rounded-md px-3 py-2">
          <CheckCircle2 size={14} /> {notice}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-xs text-error bg-error/10 border border-error/30 rounded-md px-3 py-2">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <div className="grid grid-cols-[300px_1fr] gap-3 min-h-[400px]">
        <div className="border border-border rounded-lg overflow-hidden flex flex-col">
          {entries.length === 0 && (
            <div className="px-4 py-6 text-xs text-text-muted text-center">
              {t('hooks.empty', 'No hooks configured')}
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {HOOK_EVENTS.map((ev) => {
              const forEvent = entries.filter((e) => e.event === ev);
              if (forEvent.length === 0) return null;
              return (
                <div key={ev} className="border-b border-border-muted">
                  <div className="px-3 py-1.5 bg-surface text-[10px] uppercase tracking-wide text-text-muted">
                    {ev}
                  </div>
                  {forEvent.map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => editHandler(entry)}
                      className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                        editingIndex === entry.index && selectedEvent === entry.event
                          ? 'bg-accent/10'
                          : 'hover:bg-surface-hover'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] uppercase tracking-wide text-accent">
                          {entry.handler.type}
                        </span>
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            void handleDelete(entry);
                          }}
                          className="text-text-muted hover:text-error"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                      <div className="text-text-primary font-mono truncate mt-0.5">
                        {entry.handler.command ?? entry.handler.url ?? entry.handler.prompt ?? '—'}
                      </div>
                      {entry.handler.if && (
                        <div className="text-[10px] text-text-muted mt-0.5">
                          if: {entry.handler.if}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        <div className="border border-border rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-secondary">
                {t('hooks.event', 'Event')}
              </label>
              <select
                value={selectedEvent}
                onChange={(ev) => setSelectedEvent(ev.target.value as HookEvent)}
                className="w-full px-2 py-1.5 rounded-md bg-surface border border-border text-xs text-text-primary focus:outline-none focus:border-accent"
              >
                {HOOK_EVENTS.map((ev) => (
                  <option key={ev} value={ev}>
                    {ev}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-secondary">
                {t('hooks.type', 'Handler type')}
              </label>
              <select
                value={draft.type}
                onChange={(ev) => setDraft({ ...draft, type: ev.target.value as HandlerType })}
                className="w-full px-2 py-1.5 rounded-md bg-surface border border-border text-xs text-text-primary focus:outline-none focus:border-accent"
              >
                <option value="command">command</option>
                <option value="http">http</option>
                <option value="prompt">prompt</option>
                <option value="agent">agent</option>
              </select>
            </div>
          </div>

          {draft.type === 'command' && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-secondary">
                {t('hooks.command', 'Shell command')}
              </label>
              <textarea
                value={draft.command ?? ''}
                onChange={(ev) => setDraft({ ...draft, command: ev.target.value })}
                placeholder={'eslint --fix $FILE'}
                rows={3}
                className="w-full px-3 py-2 rounded-md bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent font-mono"
              />
              <p className="text-[10px] text-text-muted">
                {t(
                  'hooks.commandHint',
                  'Variables: $TOOL_NAME, $FILE, $SESSION_ID, $CWD, $TOOL_INPUT'
                )}
              </p>
            </div>
          )}

          {draft.type === 'http' && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-secondary">
                {t('hooks.url', 'HTTP endpoint')}
              </label>
              <input
                value={draft.url ?? ''}
                onChange={(ev) => setDraft({ ...draft, url: ev.target.value })}
                placeholder="https://example.com/hook"
                className="w-full px-3 py-1.5 rounded-md bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent font-mono"
              />
            </div>
          )}

          {(draft.type === 'prompt' || draft.type === 'agent') && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-secondary">
                {t('hooks.prompt', 'Prompt')}
              </label>
              <textarea
                value={draft.prompt ?? ''}
                onChange={(ev) => setDraft({ ...draft, prompt: ev.target.value })}
                rows={3}
                className="w-full px-3 py-2 rounded-md bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-secondary">
                {t('hooks.ifFilter', 'If (tool matches)')}
              </label>
              <input
                value={draft.if ?? ''}
                onChange={(ev) => setDraft({ ...draft, if: ev.target.value })}
                placeholder="str_replace_editor"
                className="w-full px-3 py-1.5 rounded-md bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-secondary">
                {t('hooks.timeout', 'Timeout (ms)')}
              </label>
              <input
                type="number"
                value={draft.timeout ?? 10000}
                onChange={(ev) =>
                  setDraft({ ...draft, timeout: Number(ev.target.value) || 10000 })
                }
                className="w-full px-3 py-1.5 rounded-md bg-surface border border-border text-sm text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            {(draft.type === 'command' || draft.type === 'http') && (
              <button
                onClick={() => void handleTest()}
                disabled={
                  isTesting
                  || (draft.type === 'command' && !draft.command)
                  || (draft.type === 'http' && !draft.url)
                }
                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-surface border border-accent text-accent hover:bg-accent/10 disabled:opacity-50 transition-colors"
              >
                <Play size={12} />
                {isTesting ? t('hooks.testing', 'Testing…') : t('hooks.test', 'Test')}
              </button>
            )}
            <button
              onClick={() => void handleSave()}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
            >
              <Save size={12} />
              {t('hooks.save', 'Save')}
            </button>
          </div>

          {testResult && (
            <div
              className={`rounded-md border p-3 text-xs space-y-1 ${
                testResult.success
                  ? 'bg-success/10 border-success/30'
                  : 'bg-error/10 border-error/30'
              }`}
            >
              <div className="flex items-center gap-2">
                {testResult.success ? (
                  <CheckCircle2 size={12} className="text-success" />
                ) : (
                  <AlertCircle size={12} className="text-error" />
                )}
                <span className="font-medium">
                  {t('hooks.exitCode', 'Exit')}: {testResult.exitCode ?? '—'} ·{' '}
                  {testResult.durationMs}ms
                </span>
              </div>
              {testResult.error && (
                <div className="text-error font-mono">{testResult.error}</div>
              )}
              {testResult.stdout && (
                <pre className="text-text-secondary font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {testResult.stdout}
                </pre>
              )}
              {testResult.stderr && (
                <pre className="text-warning font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {testResult.stderr}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
