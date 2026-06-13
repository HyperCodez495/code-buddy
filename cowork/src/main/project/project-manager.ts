/**
 * ProjectManager — Claude Cowork parity
 *
 * Manages projects: persistent workspaces with scoped memory, description,
 * and configuration. Each project owns a `.codebuddy/memory/` folder in its
 * workspace path for cross-session memory consolidation.
 *
 * @module main/project/project-manager
 */

import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { log, logError, logWarn } from '../utils/logger';
import type { DatabaseInstance, ProjectRow } from '../db/database';

export interface Project {
  id: string;
  name: string;
  description?: string;
  workspacePath?: string;
  memoryConfig?: ProjectMemoryConfig;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectMemoryConfig {
  autoConsolidate?: boolean;
  maxMemoryEntries?: number;
  includeICM?: boolean;
  memoryStrategy?: 'auto' | 'manual' | 'rolling';
}

export interface ProjectCreateInput {
  name: string;
  description?: string;
  workspacePath?: string;
  memoryConfig?: ProjectMemoryConfig;
}

export interface ProjectUpdateInput {
  name?: string;
  description?: string;
  workspacePath?: string;
  memoryConfig?: ProjectMemoryConfig;
}

const DEFAULT_MEMORY_CONFIG: ProjectMemoryConfig = {
  autoConsolidate: true,
  maxMemoryEntries: 100,
  includeICM: false,
  memoryStrategy: 'auto',
};

export class ProjectManager {
  private db: DatabaseInstance;
  private activeProjectId: string | null = null;
  private onProjectChange?: (project: Project | null) => void;

  constructor(db: DatabaseInstance) {
    this.db = db;
  }

  /** Subscribe to active project changes */
  setProjectChangeListener(listener: (project: Project | null) => void): void {
    this.onProjectChange = listener;
  }

  /** Create a new project */
  create(input: ProjectCreateInput): Project {
    const now = Date.now();
    const id = uuidv4();
    const memoryConfig = { ...DEFAULT_MEMORY_CONFIG, ...input.memoryConfig };

    const project: Project = {
      id,
      name: input.name,
      description: input.description,
      workspacePath: input.workspacePath,
      memoryConfig,
      createdAt: now,
      updatedAt: now,
    };

    this.db.projects.create({
      id,
      name: project.name,
      description: project.description ?? null,
      workspace_path: project.workspacePath ?? null,
      memory_config: JSON.stringify(memoryConfig),
      created_at: now,
      updated_at: now,
    });

    // Initialize memory folder in workspace
    if (project.workspacePath) {
      this.initMemoryFolder(project.workspacePath);
    }

    log('[ProjectManager] Created project:', project.name, id);
    return project;
  }

  /** Update an existing project */
  update(id: string, updates: ProjectUpdateInput): Project | null {
    const existing = this.get(id);
    if (!existing) {
      logWarn('[ProjectManager] Cannot update unknown project:', id);
      return null;
    }

    const dbUpdates: Partial<ProjectRow> = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.description !== undefined) dbUpdates.description = updates.description;
    if (updates.workspacePath !== undefined) dbUpdates.workspace_path = updates.workspacePath;
    if (updates.memoryConfig !== undefined) {
      dbUpdates.memory_config = JSON.stringify({
        ...existing.memoryConfig,
        ...updates.memoryConfig,
      });
    }

    this.db.projects.update(id, dbUpdates);

    // Re-initialize memory folder if workspace path changed
    if (updates.workspacePath && updates.workspacePath !== existing.workspacePath) {
      this.initMemoryFolder(updates.workspacePath);
    }

    const updated = this.get(id)!;

    if (this.activeProjectId === id) {
      this.onProjectChange?.(updated);
    }

    return updated;
  }

  /** Get a project by id */
  get(id: string): Project | null {
    const row = this.db.projects.get(id);
    if (!row) return null;
    return this.rowToProject(row);
  }

  /** List all projects ordered by updated_at desc */
  list(): Project[] {
    return this.db.projects.getAll().map((row) => this.rowToProject(row));
  }

  /** Delete a project (sessions remain but lose their project link) */
  delete(id: string): boolean {
    const existing = this.get(id);
    if (!existing) return false;

    this.db.projects.delete(id);

    // Detach any sessions pointing to this project
    try {
      this.db.raw.prepare('UPDATE sessions SET project_id = NULL WHERE project_id = ?').run(id);
    } catch (err) {
      logError('[ProjectManager] Failed to detach sessions from project:', err);
    }

    if (this.activeProjectId === id) {
      this.setActive(null);
    }

    log('[ProjectManager] Deleted project:', id);
    return true;
  }

  /** Set the active project */
  setActive(id: string | null): Project | null {
    if (id === null) {
      this.activeProjectId = null;
      this.onProjectChange?.(null);
      return null;
    }

    const project = this.get(id);
    if (!project) {
      logWarn('[ProjectManager] Cannot set active unknown project:', id);
      return null;
    }

    this.activeProjectId = id;
    this.onProjectChange?.(project);
    return project;
  }

  /** Get the active project */
  getActive(): Project | null {
    if (!this.activeProjectId) return null;
    return this.get(this.activeProjectId);
  }

  /** Get the active project id (without a DB round-trip) */
  getActiveId(): string | null {
    return this.activeProjectId;
  }

  /** Initialize .codebuddy/memory/ folder in the workspace */
  private initMemoryFolder(workspacePath: string): void {
    try {
      if (!existsSync(workspacePath)) {
        logWarn('[ProjectManager] Workspace path does not exist:', workspacePath);
        return;
      }

      const memoryDir = join(workspacePath, '.codebuddy', 'memory');
      if (!existsSync(memoryDir)) {
        mkdirSync(memoryDir, { recursive: true });
      }

      // Seed an empty MEMORY.md if missing
      const memoryFile = join(memoryDir, 'MEMORY.md');
      if (!existsSync(memoryFile)) {
        writeFileSync(
          memoryFile,
          '# Project Memory\n\n' +
            '<!-- This file is managed by Code Buddy Cowork. ' +
            'Entries are consolidated across sessions. -->\n\n',
          'utf-8'
        );
      }

      log('[ProjectManager] Initialized memory folder:', memoryDir);
    } catch (err) {
      logError('[ProjectManager] Failed to initialize memory folder:', err);
    }
  }

  /** Get the memory folder path for a project */
  getMemoryPath(projectId: string): string | null {
    const project = this.get(projectId);
    if (!project?.workspacePath) return null;
    return join(project.workspacePath, '.codebuddy', 'memory');
  }

  private rowToProject(row: ProjectRow): Project {
    let memoryConfig: ProjectMemoryConfig = { ...DEFAULT_MEMORY_CONFIG };
    if (row.memory_config) {
      try {
        memoryConfig = { ...DEFAULT_MEMORY_CONFIG, ...JSON.parse(row.memory_config) };
      } catch (err) {
        logWarn('[ProjectManager] Failed to parse memory_config for', row.id, err);
      }
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      workspacePath: row.workspace_path ?? undefined,
      memoryConfig,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
