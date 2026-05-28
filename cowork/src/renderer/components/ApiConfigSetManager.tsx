import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers, Plus, Save, Trash2, Pencil } from 'lucide-react';
import type { ApiConfigSet } from '../types';

type PendingConfigSetAction =
  | { type: 'switch'; targetSetId: string };

interface ApiConfigSetManagerProps {
  configSets: ApiConfigSet[];
  activeConfigSetId: string;
  currentConfigSet: ApiConfigSet | null;
  pendingConfigSetAction: PendingConfigSetAction | null;
  pendingConfigSet: ApiConfigSet | null;
  hasUnsavedChanges: boolean;
  isMutatingConfigSet: boolean;
  isSaving: boolean;
  canDeleteCurrentConfigSet: boolean;
  onSwitchSet: (setId: string) => Promise<void> | void;
  onRequestCreateBlankSet: () => Promise<void> | void;
  onSaveCurrentSet: () => Promise<boolean> | Promise<void> | void;
  onRenameSet: (id: string, name: string) => Promise<boolean> | Promise<void> | void;
  onDeleteSet: (id: string) => Promise<boolean> | Promise<void> | void;
  onCancelPendingAction: () => void;
  onSaveAndContinuePendingAction: () => Promise<void> | void;
  onDiscardAndContinuePendingAction: () => Promise<void> | void;
}

const LEGACY_SYSTEM_SET_NAMES = new Set(['默认方案', 'Par défaut', 'Default']);

export function ApiConfigSetManager(props: ApiConfigSetManagerProps) {
  const { t } = useTranslation();
  const {
    configSets,
    activeConfigSetId,
    currentConfigSet,
    pendingConfigSetAction,
    pendingConfigSet,
    hasUnsavedChanges,
    isMutatingConfigSet,
    isSaving,
    canDeleteCurrentConfigSet,
    onSwitchSet,
    onRequestCreateBlankSet,
    onSaveCurrentSet,
    onRenameSet,
    onDeleteSet,
    onCancelPendingAction,
    onSaveAndContinuePendingAction,
    onDiscardAndContinuePendingAction,
  } = props;

  const [activeLocalDialog, setActiveLocalDialog] = useState<'none' | 'delete'>('none');
  const [renameName, setRenameName] = useState('');
  const [isInlineRenaming, setIsInlineRenaming] = useState(false);
  const displaySetName = useCallback((set: ApiConfigSet | null | undefined) => {
    if (!set) {
      return '-';
    }
    if (set.isSystem && LEGACY_SYSTEM_SET_NAMES.has(set.name)) {
      return t('api.defaultSetName', 'Default profile');
    }
    return set.name;
  }, [t]);

  useEffect(() => {
    setActiveLocalDialog('none');
    setRenameName(displaySetName(currentConfigSet));
    setIsInlineRenaming(false);
  }, [activeConfigSetId, currentConfigSet, displaySetName]);

  const pendingActionMessage = t('api.unsavedSwitchPrompt', {
    name: displaySetName(pendingConfigSet),
  });
  const hasDialogOpen = activeLocalDialog !== 'none';
  const canRenameCurrentConfigSet = Boolean(currentConfigSet);

  const cancelInlineRename = () => {
    setRenameName(displaySetName(currentConfigSet));
    setIsInlineRenaming(false);
  };

  const commitInlineRename = async () => {
    if (!currentConfigSet) {
      setIsInlineRenaming(false);
      return;
    }
    const nextName = renameName.trim();
    if (
      !nextName ||
      nextName === currentConfigSet.name ||
      nextName === displaySetName(currentConfigSet)
    ) {
      setRenameName(displaySetName(currentConfigSet));
      setIsInlineRenaming(false);
      return;
    }
    const renamed = await onRenameSet(currentConfigSet.id, nextName);
    if (renamed === false) {
      setRenameName(currentConfigSet.name);
      return;
    }
    setIsInlineRenaming(false);
  };

  return (
    <div className="space-y-3 border-b border-border-muted pb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Layers className="h-4 w-4" />
          {t('api.configSet')}
          {hasUnsavedChanges && (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] text-warning">
              {t('api.unsavedBadge')}
            </span>
          )}
        </label>
        <span className="text-xs text-text-muted">{t('api.currentSetSavingHint')}</span>
      </div>

      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
        {isInlineRenaming ? (
          <input
            type="text"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onBlur={() => {
              void commitInlineRename();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void commitInlineRename();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                cancelInlineRename();
              }
            }}
            autoFocus
            disabled={isMutatingConfigSet || hasDialogOpen}
            placeholder={t('api.createSetNamePlaceholder')}
            className="min-h-10 w-full rounded-lg border border-border-muted bg-background px-3 py-2.5 text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60"
          />
        ) : (
          <select
            value={activeConfigSetId}
            onChange={(e) => {
              void onSwitchSet(e.target.value);
            }}
            disabled={isMutatingConfigSet || hasDialogOpen}
            className="min-h-10 w-full rounded-lg border border-border-muted bg-background px-3 py-2.5 text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60"
          >
            {configSets.map((set) => (
              <option key={set.id} value={set.id}>
                {set.isSystem
                  ? `${displaySetName(set)} (${t('api.defaultSetTag')})`
                  : displaySetName(set)}
              </option>
            ))}
          </select>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            title={t('common.save')}
            aria-label={t('common.save')}
            onClick={() => {
              void onSaveCurrentSet();
            }}
            disabled={isMutatingConfigSet || hasDialogOpen || isInlineRenaming}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border-muted bg-background px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {t('common.save')}
          </button>
          <button
            type="button"
            title={t('api.newSet')}
            aria-label={t('api.newSet')}
            onClick={() => {
              void onRequestCreateBlankSet();
            }}
            disabled={isMutatingConfigSet || hasDialogOpen || isInlineRenaming}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border-muted bg-background px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('api.newSet')}
          </button>
          <button
            type="button"
            title={t('api.renameSet')}
            aria-label={t('api.renameSet')}
            onClick={() => {
              if (!currentConfigSet) {
                return;
              }
              setRenameName(displaySetName(currentConfigSet));
              setIsInlineRenaming(true);
            }}
            disabled={
              isMutatingConfigSet ||
              !canRenameCurrentConfigSet ||
              hasDialogOpen ||
              isInlineRenaming
            }
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border-muted bg-background px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t('api.renameSet')}
          </button>
          <button
            type="button"
            title={t('api.deleteSet')}
            aria-label={t('api.deleteSet')}
            onClick={() => setActiveLocalDialog('delete')}
            disabled={
              isMutatingConfigSet ||
              !canDeleteCurrentConfigSet ||
              hasDialogOpen ||
              isInlineRenaming
            }
            className="inline-flex min-h-10 items-center justify-center rounded-lg px-2.5 py-2 text-text-muted transition-colors hover:bg-error/10 hover:text-error disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {isInlineRenaming && (
        <p className="text-[11px] text-text-muted">{t('api.renameInlineHint')}</p>
      )}

      {activeLocalDialog === 'delete' && currentConfigSet && (
        <div className="space-y-3 rounded-lg border border-error/30 bg-error/10 px-3 py-3">
          <p className="text-xs text-text-primary">
            {t('api.configSetDeleteConfirm', { name: displaySetName(currentConfigSet) })}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setActiveLocalDialog('none')}
              disabled={isMutatingConfigSet}
              className="px-2 py-2 rounded-lg border border-border bg-surface text-text-secondary text-xs font-medium hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!currentConfigSet || !canDeleteCurrentConfigSet) {
                  return;
                }
                const deleted = await onDeleteSet(currentConfigSet.id);
                if (deleted !== false) {
                  setActiveLocalDialog('none');
                }
              }}
              disabled={isMutatingConfigSet}
              className="px-2 py-2 rounded-lg bg-error text-white text-xs font-medium hover:bg-error/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t('api.deleteSet')}
            </button>
          </div>
        </div>
      )}

      {pendingConfigSetAction && (
        <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-3">
          <p className="text-xs text-text-primary">{pendingActionMessage}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => { void onSaveAndContinuePendingAction(); }}
              disabled={isMutatingConfigSet || isSaving}
              className="px-2 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t('api.saveAndContinue')}
            </button>
            <button
              type="button"
              onClick={() => { void onDiscardAndContinuePendingAction(); }}
              disabled={isMutatingConfigSet || isSaving}
              className="px-2 py-2 rounded-lg bg-surface-hover text-text-secondary text-xs font-medium hover:bg-surface-active disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t('api.discardAndContinue')}
            </button>
            <button
              type="button"
              onClick={onCancelPendingAction}
              disabled={isMutatingConfigSet || isSaving}
              className="px-2 py-2 rounded-lg border border-border bg-surface text-text-secondary text-xs font-medium hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {hasUnsavedChanges && !pendingConfigSetAction && (
        <p className="text-xs text-warning">{t('api.unsavedCurrentSetHint')}</p>
      )}
    </div>
  );
}
