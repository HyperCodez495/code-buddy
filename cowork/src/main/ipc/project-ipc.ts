import { ipcMain } from 'electron';
import type { ProjectManager, ProjectCreateInput, ProjectUpdateInput } from '../project/project-manager';
import type { ActivityFeed } from '../activity/activity-feed';
import { sendToRenderer } from '../ipc-main-bridge';

type ProjectManagerSource = ProjectManager | null | (() => ProjectManager | null);
type ActivityFeedSource = ActivityFeed | null | (() => ActivityFeed | null);

function resolveProjectManager(source: ProjectManagerSource): ProjectManager | null {
  return typeof source === 'function' ? source() : source;
}

function resolveActivityFeed(source: ActivityFeedSource): ActivityFeed | null {
  return typeof source === 'function' ? source() : source;
}

export function registerProjectIpcHandlers(
  projectManagerSource: ProjectManagerSource,
  activityFeedSource: ActivityFeedSource
) {
  ipcMain.handle('project.list', async () => {
    const projectManager = resolveProjectManager(projectManagerSource);
    if (!projectManager) return { projects: [] };
    return { projects: projectManager.list() };
  });

  ipcMain.handle('project.get', async (_event, id: string) => {
    const projectManager = resolveProjectManager(projectManagerSource);
    if (!projectManager) return null;
    return projectManager.get(id);
  });

  ipcMain.handle('project.create', async (_event, input: ProjectCreateInput) => {
    const projectManager = resolveProjectManager(projectManagerSource);
    if (!projectManager) throw new Error('ProjectManager not initialized');
    const project = projectManager.create(input);
    sendToRenderer({ type: 'project.created', payload: { project } });
    const activityFeed = resolveActivityFeed(activityFeedSource);
    activityFeed?.record({
      type: 'project.created',
      title: `Project created: ${project.name}`,
      description: project.description,
      projectId: project.id,
    });
    return project;
  });

  ipcMain.handle('project.update', async (_event, id: string, updates: ProjectUpdateInput) => {
    const projectManager = resolveProjectManager(projectManagerSource);
    if (!projectManager) return null;
    const project = projectManager.update(id, updates);
    if (project) {
      sendToRenderer({ type: 'project.updated', payload: { project } });
    }
    return project;
  });

  ipcMain.handle('project.delete', async (_event, id: string) => {
    const projectManager = resolveProjectManager(projectManagerSource);
    if (!projectManager) return false;
    const ok = projectManager.delete(id);
    if (ok) {
      sendToRenderer({ type: 'project.deleted', payload: { projectId: id } });
      const activityFeed = resolveActivityFeed(activityFeedSource);
      activityFeed?.record({
        type: 'project.deleted',
        title: `Project deleted`,
        projectId: id,
      });
    }
    return ok;
  });

  ipcMain.handle('project.setActive', async (_event, id: string | null) => {
    const projectManager = resolveProjectManager(projectManagerSource);
    if (!projectManager) return null;
    return projectManager.setActive(id);
  });

  ipcMain.handle('project.getActive', async () => {
    const projectManager = resolveProjectManager(projectManagerSource);
    if (!projectManager) return null;
    return projectManager.getActive();
  });
}
