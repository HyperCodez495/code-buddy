import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '../../store';
import type { Project } from '../../types';
import { SettingsContentSection } from './shared';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

export function SettingsProjects() {
  const { t } = useTranslation();
  const workingDir = useAppStore((state) => state.workingDir);
  const projects = useAppStore((state) => state.projects);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const setProjects = useAppStore((state) => state.setProjects);
  const addProject = useAppStore((state) => state.addProject);
  const updateProject = useAppStore((state) => state.updateProject);
  const removeProject = useAppStore((state) => state.removeProject);
  const setActiveProjectId = useAppStore((state) => state.setActiveProjectId);

  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftWorkspacePath, setDraftWorkspacePath] = useState('');
  const [draftAutoConsolidate, setDraftAutoConsolidate] = useState(true);
  const [draftIncludeIcm, setDraftIncludeIcm] = useState(false);
  const [draftMaxEntries, setDraftMaxEntries] = useState('100');
  const [draftMemoryStrategy, setDraftMemoryStrategy] = useState<'auto' | 'manual' | 'rolling'>(
    'auto'
  );
  const [editingId, setEditingId] = useState<string | null>(null);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || null,
    [activeProjectId, projects]
  );

  const resetDraft = useCallback(() => {
    setDraftName('');
    setDraftDescription('');
    setDraftWorkspacePath(workingDir || '');
    setDraftAutoConsolidate(true);
    setDraftIncludeIcm(false);
    setDraftMaxEntries('100');
    setDraftMemoryStrategy('auto');
    setEditingId(null);
  }, [workingDir]);

  const loadProjects = useCallback(async () => {
    if (!isElectron) return;
    setLoading(true);
    try {
      const [listResult, activeResult] = await Promise.all([
        window.electronAPI.project.list(),
        window.electronAPI.project.getActive(),
      ]);
      setProjects(listResult.projects || []);
      setActiveProjectId(activeResult?.id || null);
    } finally {
      setLoading(false);
    }
  }, [setActiveProjectId, setProjects]);

  useEffect(() => {
    resetDraft();
  }, [resetDraft]);

  useEffect(() => {
    if (!isElectron) return;
    void loadProjects();
  }, [loadProjects]);

  const beginEdit = useCallback((project: Project) => {
    setEditingId(project.id);
    setDraftName(project.name);
    setDraftDescription(project.description || '');
    setDraftWorkspacePath(project.workspacePath || '');
    setDraftAutoConsolidate(project.memoryConfig?.autoConsolidate ?? true);
    setDraftIncludeIcm(project.memoryConfig?.includeICM ?? false);
    setDraftMaxEntries(String(project.memoryConfig?.maxMemoryEntries ?? 100));
    setDraftMemoryStrategy(project.memoryConfig?.memoryStrategy ?? 'auto');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!isElectron || !draftName.trim()) {
      setNotice(t('projects.nameRequired', 'Project name is required.'));
      return;
    }

    setLoading(true);
    setNotice('');
    try {
      const payload = {
        name: draftName.trim(),
        description: draftDescription.trim() || undefined,
        workspacePath: draftWorkspacePath.trim() || undefined,
        memoryConfig: {
          autoConsolidate: draftAutoConsolidate,
          includeICM: draftIncludeIcm,
          maxMemoryEntries: Number(draftMaxEntries) || 100,
          memoryStrategy: draftMemoryStrategy,
        },
      };

      if (editingId) {
        const updated = await window.electronAPI.project.update(editingId, payload);
        if (updated) {
          updateProject(editingId, updated);
          setNotice(t('projects.updated', 'Project updated'));
        }
      } else {
        const created = await window.electronAPI.project.create(payload);
        addProject(created);
        setNotice(t('projects.created', 'Project created'));
      }
      resetDraft();
      await loadProjects();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('projects.saveFailed', 'Failed to save project'));
    } finally {
      setLoading(false);
    }
  }, [
    addProject,
    draftAutoConsolidate,
    draftDescription,
    draftIncludeIcm,
    draftMemoryStrategy,
    draftMaxEntries,
    draftName,
    draftWorkspacePath,
    editingId,
    loadProjects,
    resetDraft,
    t,
    updateProject,
  ]);

  const handleDelete = useCallback(
    async (project: Project) => {
      if (!isElectron || !window.confirm(t('projects.deleteConfirm', { name: project.name }))) {
        return;
      }
      setLoading(true);
      setNotice('');
      try {
        const ok = await window.electronAPI.project.delete(project.id);
        if (ok) {
          removeProject(project.id);
          if (activeProjectId === project.id) {
            setActiveProjectId(null);
          }
          setNotice(t('projects.deleted', 'Project deleted'));
        }
      } catch (error) {
        setNotice(error instanceof Error ? error.message : t('projects.deleteFailed', 'Failed to delete project'));
      } finally {
        setLoading(false);
      }
    },
    [activeProjectId, removeProject, setActiveProjectId, t]
  );

  const handleSetActive = useCallback(
    async (projectId: string | null) => {
      if (!isElectron) return;
      setLoading(true);
      setNotice('');
      try {
        const next = await window.electronAPI.project.setActive(projectId);
        setActiveProjectId(next?.id || null);
        setNotice(
          next
            ? t('projects.activeSet', { name: next.name })
            : t('projects.activeCleared', 'Project context cleared')
        );
      } catch (error) {
        setNotice(error instanceof Error ? error.message : t('projects.activateFailed', 'Failed to switch project'));
      } finally {
        setLoading(false);
      }
    },
    [setActiveProjectId, t]
  );

  return (
    <div className="space-y-5">
      <SettingsContentSection
        title={t('projects.title', 'Projects')}
        description={t(
          'projects.hint',
          'Group sessions by workspace, keep a scoped memory folder, and switch the active project context.'
        )}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder={t('projects.namePlaceholder', 'Project name')}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary"
          />
          <input
            value={draftWorkspacePath}
            onChange={(event) => setDraftWorkspacePath(event.target.value)}
            placeholder={t('projects.workspacePlaceholder', 'Workspace path')}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary"
          />
          <textarea
            value={draftDescription}
            onChange={(event) => setDraftDescription(event.target.value)}
            placeholder={t('projects.descriptionPlaceholder', 'Description')}
            rows={3}
            className="md:col-span-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary"
          />
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={draftAutoConsolidate}
              onChange={(event) => setDraftAutoConsolidate(event.target.checked)}
            />
            {t('projects.autoConsolidate', 'Auto-consolidate project memory')}
          </label>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={draftIncludeIcm}
              onChange={(event) => setDraftIncludeIcm(event.target.checked)}
            />
            {t('projects.includeIcm', 'Include ICM in project memory')}
          </label>
          <input
            value={draftMaxEntries}
            onChange={(event) => setDraftMaxEntries(event.target.value)}
            placeholder={t('projects.maxEntries', 'Max memory entries')}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary"
          />
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <span className="shrink-0">{t('projects.memoryStrategy', 'Memory strategy')}</span>
            <select
              value={draftMemoryStrategy}
              onChange={(event) =>
                setDraftMemoryStrategy(event.target.value as 'auto' | 'manual' | 'rolling')
              }
              className="min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary"
            >
              <option value="auto">{t('projects.memoryStrategyAuto', 'Auto')}</option>
              <option value="manual">{t('projects.memoryStrategyManual', 'Manual')}</option>
              <option value="rolling">{t('projects.memoryStrategyRolling', 'Rolling')}</option>
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {editingId ? t('projects.saveChanges', 'Save changes') : t('projects.create', 'Create project')}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetDraft}
                className="rounded-lg border border-border px-3 py-2 text-sm text-text-secondary"
              >
                {t('projects.cancelEdit', 'Cancel')}
              </button>
            )}
          </div>
        </div>
        {notice && <div className="text-xs text-text-muted">{notice}</div>}
      </SettingsContentSection>

      <SettingsContentSection
        title={t('projects.listTitle', 'Project list')}
        description={t(
          'projects.listHint',
          'Switch the active project or edit an existing workspace profile.'
        )}
      >
        {loading && <div className="text-xs text-text-muted">{t('common.loading')}</div>}
        {!loading && projects.length === 0 && (
          <div className="text-xs text-text-muted">{t('projects.empty', 'No projects yet')}</div>
        )}
        <div className="space-y-3">
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            return (
              <div
                key={project.id}
                className={`rounded-xl border px-4 py-4 ${
                  isActive ? 'border-accent bg-accent/5' : 'border-border-muted bg-background'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium text-text-primary">{project.name}</div>
                      {isActive && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                          <CheckCircle className="h-3 w-3" />
                          {t('projects.active', 'Active')}
                        </span>
                      )}
                    </div>
                    {project.description && (
                      <div className="mt-1 text-xs leading-5 text-text-muted">{project.description}</div>
                    )}
                    {project.workspacePath && (
                      <div className="mt-2 inline-flex items-center gap-1 text-xs text-text-secondary">
                        <FolderOpen className="h-3 w-3" />
                        {project.workspacePath}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSetActive(isActive ? null : project.id)}
                      className="rounded-lg border border-border px-3 py-2 text-xs text-text-secondary"
                    >
                      {isActive ? t('projects.clearActive', 'Clear active') : t('projects.setActive', 'Set active')}
                    </button>
                    <button
                      type="button"
                      onClick={() => beginEdit(project)}
                      className="rounded-lg border border-border px-3 py-2 text-xs text-text-secondary"
                    >
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(project)}
                      className="rounded-lg border border-border px-3 py-2 text-xs text-error"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {activeProject && (
          <div className="text-xs text-text-muted">
            {t('projects.current', { name: activeProject.name })}
          </div>
        )}
      </SettingsContentSection>
    </div>
  );
}
