/**
 * SettingsCustomCommands — Phase 3 step 6
 *
 * CRUD UI for user-defined slash commands. The commands merge into
 * the built-in catalog and appear in the /-palette in ChatView.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Save, Trash2, SlashSquare } from 'lucide-react';

interface CustomCommand {
  name: string;
  description: string;
  prompt: string;
  isBuiltin: boolean;
}

interface Draft {
  original?: string;
  name: string;
  description: string;
  body: string;
}

const EMPTY: Draft = { name: '', description: '', body: '' };

export function SettingsCustomCommands() {
  const { t } = useTranslation();
  const [commands, setCommands] = useState<CustomCommand[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!window.electronAPI?.customCommands?.list) return;
    const result = (await window.electronAPI.customCommands.list()) as CustomCommand[];
    setCommands(result);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectCommand = (cmd: CustomCommand) => {
    setSelected(cmd.name);
    setDraft({
      original: cmd.name,
      name: cmd.name,
      description: cmd.description,
      body: cmd.prompt,
    });
    setDirty(false);
  };

  const newCommand = () => {
    setSelected(null);
    setDraft(EMPTY);
    setDirty(true);
  };

  const handleSave = async () => {
    if (!draft.name.trim() || !draft.body.trim()) return;
    setSaving(true);
    try {
      const result = await window.electronAPI?.customCommands?.save({
        name: draft.name.trim(),
        description: draft.description.trim(),
        body: draft.body,
      });
      if (result?.success) {
        await load();
        setSelected(draft.name.trim());
        setDirty(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!window.confirm(t('customCommands.deleteConfirm'))) return;
    await window.electronAPI?.customCommands?.delete(selected);
    await load();
    setSelected(null);
    setDraft(EMPTY);
    setDirty(false);
  };

  return (
    <div className="space-y-4" data-testid="settings-custom-commands">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            {t('customCommands.title')}
          </h3>
          <p className="text-xs text-text-muted mt-1">{t('customCommands.hint')}</p>
        </div>
        <button
          onClick={newCommand}
          data-testid="custom-command-new"
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
        >
          <Plus size={12} />
          {t('customCommands.new')}
        </button>
      </div>

      <div className="grid grid-cols-[240px_1fr] gap-3 min-h-[320px]">
        <div className="border border-border rounded-lg overflow-hidden flex flex-col">
          {commands.length === 0 && (
            <div className="px-4 py-6 text-xs text-text-muted text-center">
              {t('customCommands.empty')}
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {commands.map((cmd) => (
              <button
                key={cmd.name}
                onClick={() => selectCommand(cmd)}
                data-testid={`custom-command-row-${cmd.name}`}
                className={`w-full text-left px-3 py-2 border-b border-border-muted transition-colors ${
                  selected === cmd.name ? 'bg-accent/10' : 'hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <SlashSquare size={12} className="text-accent shrink-0" />
                  <span className="text-xs font-medium text-text-primary truncate">
                    /{cmd.name}
                  </span>
                </div>
                {cmd.description && (
                  <p className="text-[11px] text-text-muted mt-0.5 truncate">
                    {cmd.description}
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="border border-border rounded-lg p-4 space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-secondary">
              {t('customCommands.name')}
            </label>
            <div className="flex items-center gap-1">
              <span className="text-text-muted font-mono">/</span>
              <input
                value={draft.name}
                onChange={(ev) => {
                  setDraft({ ...draft, name: ev.target.value });
                  setDirty(true);
                }}
                data-testid="custom-command-name-input"
                placeholder="my-command"
                className="flex-1 px-3 py-1.5 rounded-md bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent font-mono"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-secondary">
              {t('customCommands.description')}
            </label>
            <input
              value={draft.description}
              onChange={(ev) => {
                setDraft({ ...draft, description: ev.target.value });
                setDirty(true);
              }}
              data-testid="custom-command-description-input"
              className="w-full px-3 py-1.5 rounded-md bg-surface border border-border text-sm text-text-primary focus:outline-none focus:border-accent"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-secondary">
              {t('customCommands.body')}
            </label>
            <textarea
              value={draft.body}
              onChange={(ev) => {
                setDraft({ ...draft, body: ev.target.value });
                setDirty(true);
              }}
              data-testid="custom-command-body-input"
              placeholder={t('customCommands.bodyPlaceholder')}
              rows={10}
              className="w-full px-3 py-2 rounded-md bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent font-mono"
            />
            <p className="text-[11px] text-text-muted">{t('customCommands.argsHint')}</p>
          </div>
          <div className="flex items-center justify-end gap-2">
            {selected && (
              <button
                onClick={handleDelete}
                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-error/10 text-error hover:bg-error/20 transition-colors"
              >
                <Trash2 size={12} />
                {t('common.delete')}
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!dirty || saving || !draft.name.trim() || !draft.body.trim()}
              data-testid="custom-command-save"
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              <Save size={12} />
              {t('customCommands.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
