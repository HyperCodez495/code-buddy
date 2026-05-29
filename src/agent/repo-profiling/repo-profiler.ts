/**
 * RepoProfiler orchestrator.
 *
 * Delegates to language profilers and infrastructure detectors,
 * then assembles the final RepoProfile.
 */

import fs from 'fs';
import path from 'path';
import type { RepoProfile, ProfilingContext } from './types.js';
import { createProfilingContext } from './types.js';
import { createFsHelpers, type FsHelpers } from './fs-helpers.js';
import { getCachePath, loadCache, isCacheStale, saveCache } from './cache.js';
import { buildContextPack } from './context-pack.js';
import { LANGUAGE_PROFILERS } from './languages/index.js';
import { profileCommonDirs, profileInfrastructure } from './infrastructure/index.js';

export class RepoProfiler {
  private cwd: string;
  private cachePath: string;
  private fsh: FsHelpers;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
    this.cachePath = getCachePath(this.cwd);
    this.fsh = createFsHelpers();
  }

  /** Get or compute the repo profile. Uses cache if config unchanged. */
  async getProfile(): Promise<RepoProfile> {
    const cached = loadCache(this.cachePath);
    if (cached && !isCacheStale(cached, this.cwd)) {
      return cached;
    }
    const profile = await this.computeProfile();
    saveCache(this.cachePath, profile);
    return profile;
  }

  /** Force recompute (ignores cache). */
  async refresh(): Promise<RepoProfile> {
    const profile = await this.computeProfile();
    saveCache(this.cachePath, profile);
    return profile;
  }

  private async computeProfile(): Promise<RepoProfile> {
    const ctx = createProfilingContext(this.cwd);

    // Phase 1: detect languages
    for (const profiler of LANGUAGE_PROFILERS) {
      profiler.detect(ctx, this.fsh);
    }

    // Phase 2: common directory detection
    profileCommonDirs(ctx, this.fsh);

    // Phase 3: extended language profiling
    for (const profiler of LANGUAGE_PROFILERS) {
      profiler.profile(ctx, this.fsh);
    }

    // Phase 4: fallbacks
    this.applyFallbacks(ctx);

    // Phase 5: infrastructure (dirs, CI, Docker, DB, scale, etc.)
    profileInfrastructure(ctx, this.fsh);

    // Phase 6: assemble RepoProfile
    return this.assemble(ctx);
  }

  private applyFallbacks(ctx: ProfilingContext): void {
    // Fallback entry points for non-npm projects
    if (ctx.entryPoints.length === 0) {
      for (const f of ['src/index.ts', 'src/main.ts', 'src/app.ts', 'index.ts', 'main.ts']) {
        if (this.fsh.exists(path.join(ctx.cwd, f))) { ctx.entryPoints.push(f); break; }
      }
    }

    // Fallback project names
    if (!ctx.projectName) {
      if (ctx.cargoPath && this.fsh.exists(ctx.cargoPath)) {
        try {
          const cargo = fs.readFileSync(ctx.cargoPath, 'utf-8');
          const nameMatch = cargo.match(/^name\s*=\s*"([^"]+)"/m);
          if (nameMatch) ctx.projectName = nameMatch[1];
        } catch { /* ignore */ }
      } else if (ctx.goModPath && this.fsh.exists(ctx.goModPath)) {
        try {
          const gomod = fs.readFileSync(ctx.goModPath, 'utf-8');
          const modMatch = gomod.match(/^module\s+(\S+)/m);
          const moduleName = modMatch?.[1];
          if (moduleName) ctx.projectName = moduleName.split('/').pop();
        } catch { /* ignore */ }
      }
    }

    // Test framework fallback
    if (!ctx.testFramework) {
      if (ctx.languages.includes('Python')) ctx.testFramework = 'pytest';
      else if (ctx.languages.includes('Rust')) ctx.testFramework = 'cargo test';
      else if (ctx.languages.includes('Go')) ctx.testFramework = 'go test';
    }
  }

  private assemble(ctx: ProfilingContext): RepoProfile {
    const profile: RepoProfile = {
      detectedAt: new Date().toISOString(),
      languages: ctx.languages,
      framework: ctx.framework,
      packageManager: ctx.packageManager,
      commands: ctx.commands,
      directories: ctx.directories,
      conventions: ctx.conventions,
      contextPack: '',
      _configMtime: ctx.configMtime,
      projectName: ctx.projectName,
      projectDescription: ctx.projectDescription,
      moduleType: ctx.moduleType,
      testFramework: ctx.testFramework,
      testSetupFiles: ctx.testSetupFiles.length > 0 ? ctx.testSetupFiles : undefined,
      entryPoints: ctx.entryPoints.length > 0 ? ctx.entryPoints : undefined,
      keyDependencies: ctx.keyDependencies.length > 0 ? ctx.keyDependencies : undefined,
      linter: ctx.linter,
      formatter: ctx.formatter,
      buildTool: ctx.buildTool,
      monorepo: ctx.monorepo || undefined,
      topLevelDirs: ctx.topLevelDirs.length > 0 ? ctx.topLevelDirs : undefined,
      srcSubdirs: ctx.srcSubdirs.length > 0 ? ctx.srcSubdirs : undefined,
      ciProvider: ctx.ciProvider,
      existingDocs: (ctx.existingDocs.readme || ctx.existingDocs.claudeMd) ? ctx.existingDocs : undefined,
      scripts: Object.keys(ctx.scripts).length > 0 ? ctx.scripts : undefined,
      containerized: ctx.containerized || undefined,
      databases: ctx.databases.length > 0 ? ctx.databases : undefined,
      envExample: ctx.envExample || undefined,
      scale: ctx.scale,
      workspaces: ctx.workspaces && ctx.workspaces.length > 0 ? ctx.workspaces : undefined,
      configFiles: ctx.configFiles.length > 0 ? ctx.configFiles : undefined,
      validateScript: ctx.validateScript,
      tsConfig: ctx.tsConfig,
      nodeVersion: ctx.nodeVersion,
      gitHooks: ctx.gitHooks.length > 0 ? ctx.gitHooks : undefined,
      license: ctx.license,
    };

    profile.contextPack = buildContextPack(profile);
    return profile;
  }
}
