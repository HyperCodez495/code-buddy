/**
 * Rust profiler.
 */

import fs from 'fs';
import path from 'path';
import type { LanguageProfiler } from './language-profiler.js';
import type { ProfilingContext } from '../types.js';
import type { FsHelpers } from '../fs-helpers.js';

export const rustProfiler: LanguageProfiler = {
  id: 'rust',

  detect(ctx: ProfilingContext, fsh: FsHelpers): boolean {
    const cargoPath = path.join(ctx.cwd, 'Cargo.toml');
    if (!fsh.exists(cargoPath)) return false;

    ctx.cargoPath = cargoPath;
    ctx.languages.push('Rust');
    ctx.packageManager = 'cargo';
    ctx.configMtime = ctx.configMtime || fsh.mtime(cargoPath);
    ctx.commands.test = ctx.commands.test || 'cargo test';
    ctx.commands.build = ctx.commands.build || 'cargo build --release';
    ctx.commands.lint = ctx.commands.lint || 'cargo clippy';
    ctx.commands.format = ctx.commands.format || 'cargo fmt';

    return true;
  },

  profile(ctx: ProfilingContext, fsh: FsHelpers): void {
    if (!ctx.languages.includes('Rust')) return;
    const cargoPath = ctx.cargoPath || path.join(ctx.cwd, 'Cargo.toml');

    try {
      const cargoContent = fs.readFileSync(cargoPath, 'utf-8');

      // Name + description
      if (!ctx.projectName) {
        const nameMatch = cargoContent.match(/^\s*name\s*=\s*"([^"]+)"/m);
        if (nameMatch) ctx.projectName = nameMatch[1];
      }
      if (!ctx.projectDescription) {
        const descMatch = cargoContent.match(/^\s*description\s*=\s*"([^"]+)"/m);
        if (descMatch) ctx.projectDescription = descMatch[1];
      }

      // Edition + MSRV
      const editionMatch = cargoContent.match(/^\s*edition\s*=\s*"([^"]+)"/m);
      const msrvMatch = cargoContent.match(/^\s*rust-version\s*=\s*"([^"]+)"/m);
      if (editionMatch) ctx.buildTool = `Rust ${editionMatch[1]}`;
      if (msrvMatch) ctx.buildTool = (ctx.buildTool || 'Rust') + ` (MSRV ${msrvMatch[1]})`;

      // Workspace detection
      if (cargoContent.includes('[workspace]')) {
        ctx.monorepo = true;
      }

      // Key dependencies from [dependencies]
      const depSection = cargoContent.match(/\[dependencies\]\n([\s\S]*?)(?=\n\[|$)/);
      const depSectionBody = depSection?.[1];
      if (depSectionBody !== undefined) {
        const rustNotable: Record<string, string> = {
          'tokio': 'tokio', 'async-std': 'async-std',
          'actix-web': 'actix-web', 'axum': 'axum', 'rocket': 'rocket', 'warp': 'warp',
          'serde': 'serde', 'serde_json': 'serde_json',
          'sqlx': 'sqlx', 'diesel': 'diesel', 'sea-orm': 'sea-orm',
          'reqwest': 'reqwest', 'hyper': 'hyper',
          'clap': 'clap', 'structopt': 'structopt',
          'tracing': 'tracing', 'log': 'log', 'env_logger': 'env_logger',
          'anyhow': 'anyhow', 'thiserror': 'thiserror', 'eyre': 'eyre',
          'tauri': 'tauri', 'leptos': 'leptos', 'yew': 'yew', 'dioxus': 'dioxus',
          'tonic': 'tonic', 'prost': 'prost',
          'redis': 'redis', 'mongodb': 'mongodb',
          'tower': 'tower', 'tower-http': 'tower-http',
          'iced': 'iced', 'egui': 'egui', 'ratatui': 'ratatui',
          'rayon': 'rayon', 'crossbeam': 'crossbeam',
          'wasm-bindgen': 'wasm-bindgen',
        };
        for (const [dep] of Object.entries(rustNotable)) {
          const depRegex = new RegExp(`^\\s*${dep.replace('-', '[-_]')}\\s*=`, 'm');
          if (depRegex.test(depSectionBody) && !ctx.keyDependencies.includes(dep)) {
            ctx.keyDependencies.push(dep);
          }
        }
      }

      // Framework detection
      if (!ctx.framework) {
        if (ctx.keyDependencies.includes('axum')) ctx.framework = 'Axum';
        else if (ctx.keyDependencies.includes('actix-web')) ctx.framework = 'Actix Web';
        else if (ctx.keyDependencies.includes('rocket')) ctx.framework = 'Rocket';
        else if (ctx.keyDependencies.includes('tauri')) ctx.framework = 'Tauri';
        else if (ctx.keyDependencies.includes('leptos')) ctx.framework = 'Leptos';
        else if (ctx.keyDependencies.includes('yew')) ctx.framework = 'Yew';
        else if (ctx.keyDependencies.includes('dioxus')) ctx.framework = 'Dioxus';
        else if (ctx.keyDependencies.includes('iced')) ctx.framework = 'Iced';
        else if (ctx.keyDependencies.includes('egui')) ctx.framework = 'egui';
        else if (ctx.keyDependencies.includes('ratatui')) ctx.framework = 'Ratatui (TUI)';
      }

      // Database detection
      if (ctx.keyDependencies.includes('sqlx')) {
        if (cargoContent.includes('postgres')) ctx.databases.push('PostgreSQL');
        if (cargoContent.includes('sqlite')) ctx.databases.push('SQLite');
        if (cargoContent.includes('mysql')) ctx.databases.push('MySQL');
      }
      if (ctx.keyDependencies.includes('diesel')) {
        if (cargoContent.includes('postgres')) ctx.databases.push('PostgreSQL');
        else if (cargoContent.includes('sqlite')) ctx.databases.push('SQLite');
        else if (cargoContent.includes('mysql')) ctx.databases.push('MySQL');
      }
      if (ctx.keyDependencies.includes('redis')) ctx.databases.push('Redis');
      if (ctx.keyDependencies.includes('mongodb')) ctx.databases.push('MongoDB');
      if (ctx.keyDependencies.includes('sea-orm')) ctx.databases.push('SeaORM');
      // Deduplicate databases
      const dbSet = new Set(ctx.databases);
      ctx.databases.length = 0;
      ctx.databases.push(...dbSet);

      // Entry points
      if (ctx.entryPoints.length === 0) {
        if (fsh.exists(path.join(ctx.cwd, 'src', 'main.rs'))) ctx.entryPoints.push('src/main.rs');
        else if (fsh.exists(path.join(ctx.cwd, 'src', 'lib.rs'))) ctx.entryPoints.push('src/lib.rs');
        // Check for binary targets in src/bin/
        const binDir = path.join(ctx.cwd, 'src', 'bin');
        if (fsh.exists(binDir)) {
          try {
            for (const f of fs.readdirSync(binDir)) {
              if (f.endsWith('.rs')) ctx.entryPoints.push(`src/bin/${f}`);
            }
          } catch { /* ignore */ }
        }
      }

      // Conventions
      if (!ctx.conventions.naming) ctx.conventions.naming = 'snake_case (Rust)';
      if (!ctx.linter) ctx.linter = 'clippy';
      if (!ctx.formatter) ctx.formatter = 'rustfmt';

      // Test framework
      if (!ctx.testFramework) {
        ctx.testFramework = 'cargo test';
        if (cargoContent.includes('proptest')) ctx.testFramework = 'cargo test + proptest';
        else if (cargoContent.includes('criterion')) ctx.testFramework = 'cargo test + criterion';
      }
    } catch { /* ignore */ }
  },
};
