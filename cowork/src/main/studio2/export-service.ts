import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { errorMessage, fail, isInside, ok, safeResolve, type Studio2Result, zipDirectory } from './archive-utils.js';

export interface ExportProjectRequest { projectRoot: string; outputDir?: string; }
export interface ExportProjectResult { zipPath: string; }
export interface ImportFolderRequest { workspaceRoot: string; sourcePath: string; projectName?: string; }
export interface ImportFolderResult { projectPath: string; }

function safeName(name: string): string { return name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'project'; }

export class ExportService {
  async exportProject(request: ExportProjectRequest): Promise<Studio2Result<ExportProjectResult>> {
    try {
      const projectRoot = safeResolve(request.projectRoot); if (!projectRoot) return fail('Invalid project root');
      const outRoot = request.outputDir ? safeResolve(projectRoot, request.outputDir) : path.join(projectRoot, '.studio2');
      if (!outRoot || !isInside(projectRoot, outRoot)) return fail('Output directory must stay inside the project');
      await mkdir(outRoot, { recursive: true });
      const zipPath = path.join(outRoot, safeName(path.basename(projectRoot)) + '-' + Date.now() + '.zip');
      await zipDirectory(projectRoot, zipPath);
      return ok({ zipPath });
    } catch (error) { return fail(errorMessage(error)); }
  }
  async importFolder(request: ImportFolderRequest): Promise<Studio2Result<ImportFolderResult>> {
    try {
      const workspaceRoot = safeResolve(request.workspaceRoot); if (!workspaceRoot) return fail('Invalid workspace root');
      const source = path.resolve(request.sourcePath); if (!source || isInside(workspaceRoot, source)) return fail('Source must be outside workspace to import');
      const name = safeName(request.projectName ?? path.basename(source));
      const projectPath = safeResolve(workspaceRoot, name); if (!projectPath) return fail('Invalid destination path');
      await cp(source, projectPath, { recursive: true, errorOnExist: true, force: false });
      return ok({ projectPath });
    } catch (error) { return fail(errorMessage(error)); }
  }
}
