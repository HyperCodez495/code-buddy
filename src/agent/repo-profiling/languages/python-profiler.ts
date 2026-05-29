/**
 * Python profiler.
 */

import fs from 'fs';
import path from 'path';
import type { LanguageProfiler } from './language-profiler.js';
import type { ProfilingContext } from '../types.js';
import type { FsHelpers } from '../fs-helpers.js';

export const pythonProfiler: LanguageProfiler = {
  id: 'python',

  detect(ctx: ProfilingContext, fsh: FsHelpers): boolean {
    const pyprojectPath = path.join(ctx.cwd, 'pyproject.toml');
    const requirementsPath = path.join(ctx.cwd, 'requirements.txt');
    const setupPyPath = path.join(ctx.cwd, 'setup.py');
    const hasPython = fsh.exists(pyprojectPath) || fsh.exists(requirementsPath) || fsh.exists(setupPyPath);
    if (!hasPython) return false;

    ctx.hasPython = true;
    ctx.pyprojectPath = pyprojectPath;
    ctx.requirementsPath = requirementsPath;
    ctx.languages.push('Python');

    // Detect package manager + set default commands
    if (fsh.exists(path.join(ctx.cwd, 'uv.lock'))) {
      ctx.packageManager = ctx.packageManager || 'uv';
    } else if (fsh.exists(path.join(ctx.cwd, 'poetry.lock')) || fsh.exists(pyprojectPath)) {
      ctx.packageManager = ctx.packageManager || 'poetry';
    } else if (fsh.exists(path.join(ctx.cwd, 'Pipfile'))) {
      ctx.packageManager = ctx.packageManager || 'pip';
    } else {
      ctx.packageManager = ctx.packageManager || 'pip';
    }

    if (fsh.exists(pyprojectPath)) {
      ctx.configMtime = ctx.configMtime || fsh.mtime(pyprojectPath);
      // When pyproject.toml exists, default to poetry-prefixed commands
      ctx.commands.test = ctx.commands.test || 'poetry run pytest';
      ctx.commands.lint = ctx.commands.lint || 'poetry run ruff check .';
      ctx.commands.format = ctx.commands.format || 'poetry run black .';
    } else if (fsh.exists(requirementsPath)) {
      ctx.configMtime = ctx.configMtime || fsh.mtime(requirementsPath);
      ctx.commands.test = ctx.commands.test || 'python -m pytest';
    }

    return true;
  },

  profile(ctx: ProfilingContext, fsh: FsHelpers): void {
    if (!ctx.hasPython) return;
    const pyprojectPath = ctx.pyprojectPath!;
    const requirementsPath = ctx.requirementsPath!;

    try {
      let pyContent = '';
      if (fsh.exists(pyprojectPath)) {
        pyContent = fs.readFileSync(pyprojectPath, 'utf-8');
      }

      // Name + description
      if (!ctx.projectName) {
        const nameMatch = pyContent.match(/^\s*name\s*=\s*"([^"]+)"/m);
        if (nameMatch) ctx.projectName = nameMatch[1];
      }
      if (!ctx.projectDescription) {
        const descMatch = pyContent.match(/^\s*description\s*=\s*"([^"]+)"/m);
        if (descMatch) ctx.projectDescription = descMatch[1];
      }

      // Refine package manager detection
      if (fsh.exists(path.join(ctx.cwd, 'uv.lock'))) {
        ctx.packageManager = 'uv';
        ctx.commands.test = 'uv run pytest';
        ctx.commands.lint = 'uv run ruff check .';
        ctx.commands.format = 'uv run ruff format .';
        if (!ctx.buildTool) ctx.buildTool = 'uv';
      } else if (fsh.exists(path.join(ctx.cwd, 'poetry.lock'))) {
        ctx.packageManager = 'poetry';
        ctx.commands.test = ctx.commands.test || 'poetry run pytest';
        ctx.commands.lint = ctx.commands.lint || 'poetry run ruff check .';
        ctx.commands.format = ctx.commands.format || 'poetry run ruff format .';
        if (!ctx.buildTool) ctx.buildTool = 'poetry';
      } else if (fsh.exists(path.join(ctx.cwd, 'pdm.lock'))) {
        ctx.packageManager = 'pdm';
        ctx.commands.test = 'pdm run pytest';
        ctx.commands.lint = 'pdm run ruff check .';
        ctx.commands.format = 'pdm run ruff format .';
        if (!ctx.buildTool) ctx.buildTool = 'pdm';
      } else if (fsh.exists(path.join(ctx.cwd, 'Pipfile.lock'))) {
        ctx.commands.test = 'pipenv run pytest';
        ctx.commands.lint = 'pipenv run ruff check .';
        ctx.commands.format = 'pipenv run ruff format .';
        if (!ctx.buildTool) ctx.buildTool = 'pipenv';
      } else if (fsh.exists(path.join(ctx.cwd, 'hatch.toml')) || pyContent.includes('[tool.hatch]')) {
        ctx.commands.test = 'hatch run test';
        ctx.commands.lint = 'hatch run lint';
        ctx.commands.format = 'hatch run format';
        if (!ctx.buildTool) ctx.buildTool = 'hatch';
      }

      // Framework detection from dependencies
      const allPyDeps = new Set<string>();
      // From pyproject.toml [project].dependencies
      const depsMatch = pyContent.match(/\[project\][\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\n\s*\]/);
      if (depsMatch?.[1]) {
        for (const m of depsMatch[1].matchAll(/"([a-zA-Z0-9_-]+)/g)) {
          const dep = m[1];
          if (dep) allPyDeps.add(dep.toLowerCase());
        }
      }
      // From requirements.txt
      if (fsh.exists(requirementsPath)) {
        try {
          const reqContent = fs.readFileSync(requirementsPath, 'utf-8');
          for (const line of reqContent.split('\n')) {
            const m = line.match(/^([a-zA-Z0-9_-]+)/);
            if (m?.[1]) allPyDeps.add(m[1].toLowerCase());
          }
        } catch { /* ignore */ }
      }
      // Also scan [tool.poetry.dependencies] if present
      const poetryDeps = pyContent.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?=\[|$)/);
      if (poetryDeps?.[1]) {
        for (const m of poetryDeps[1].matchAll(/^([a-zA-Z0-9_-]+)\s*=/gm)) {
          const dep = m[1];
          if (dep) allPyDeps.add(dep.toLowerCase());
        }
      }

      // Framework
      if (!ctx.framework) {
        if (allPyDeps.has('django')) ctx.framework = 'Django';
        else if (allPyDeps.has('fastapi')) ctx.framework = 'FastAPI';
        else if (allPyDeps.has('flask')) ctx.framework = 'Flask';
        else if (allPyDeps.has('starlette')) ctx.framework = 'Starlette';
        else if (allPyDeps.has('tornado')) ctx.framework = 'Tornado';
        else if (allPyDeps.has('aiohttp')) ctx.framework = 'aiohttp';
        else if (allPyDeps.has('sanic')) ctx.framework = 'Sanic';
        else if (allPyDeps.has('litestar')) ctx.framework = 'Litestar';
        else if (allPyDeps.has('streamlit')) ctx.framework = 'Streamlit';
        else if (allPyDeps.has('gradio')) ctx.framework = 'Gradio';
        else if (allPyDeps.has('textual')) ctx.framework = 'Textual (TUI)';
        else if (allPyDeps.has('typer') || allPyDeps.has('click')) ctx.framework = allPyDeps.has('typer') ? 'Typer (CLI)' : 'Click (CLI)';
      }

      // Key dependencies
      const pyNotable = new Set([
        'django', 'fastapi', 'flask', 'starlette', 'celery', 'dramatiq',
        'sqlalchemy', 'alembic', 'tortoise-orm', 'peewee', 'django-rest-framework',
        'pydantic', 'marshmallow', 'attrs',
        'numpy', 'pandas', 'scipy', 'matplotlib', 'seaborn', 'plotly',
        'scikit-learn', 'tensorflow', 'pytorch', 'torch', 'transformers', 'langchain', 'openai',
        'httpx', 'requests', 'aiohttp',
        'pytest', 'hypothesis', 'unittest',
        'ruff', 'black', 'mypy', 'pylint', 'flake8', 'isort',
        'typer', 'click', 'rich', 'textual',
        'celery', 'dramatiq', 'rq',
        'boto3', 'google-cloud-storage',
        'redis', 'pymongo', 'psycopg2', 'asyncpg',
        'uvicorn', 'gunicorn', 'daphne',
        'streamlit', 'gradio', 'nicegui',
        'polars', 'dask', 'ray',
      ]);
      for (const dep of allPyDeps) {
        if (pyNotable.has(dep) && !ctx.keyDependencies.includes(dep)) ctx.keyDependencies.push(dep);
      }

      // Test framework
      if (!ctx.testFramework) {
        if (allPyDeps.has('pytest')) ctx.testFramework = 'pytest';
        else if (allPyDeps.has('unittest') || fsh.exists(path.join(ctx.cwd, 'tests'))) ctx.testFramework = 'unittest';
        if (allPyDeps.has('hypothesis')) ctx.testFramework = (ctx.testFramework || 'pytest') + ' + hypothesis';
      }

      // Linter / formatter
      if (!ctx.linter) {
        if (allPyDeps.has('ruff') || pyContent.includes('[tool.ruff]')) ctx.linter = 'ruff';
        else if (allPyDeps.has('pylint')) ctx.linter = 'pylint';
        else if (allPyDeps.has('flake8') || fsh.exists(path.join(ctx.cwd, '.flake8'))) ctx.linter = 'flake8';
      }
      if (!ctx.formatter) {
        if (allPyDeps.has('ruff') || pyContent.includes('[tool.ruff]')) ctx.formatter = 'ruff format';
        else if (allPyDeps.has('black') || pyContent.includes('[tool.black]')) ctx.formatter = 'black';
        else if (allPyDeps.has('autopep8')) ctx.formatter = 'autopep8';
      }
      // Type checker
      const typeChecker = allPyDeps.has('mypy') ? 'mypy' : allPyDeps.has('pyright') ? 'pyright' : undefined;
      if (typeChecker) {
        ctx.linter = ctx.linter ? `${ctx.linter} + ${typeChecker}` : typeChecker;
      }

      // Database detection
      const pyDbMap: Record<string, string> = {
        'psycopg2': 'PostgreSQL', 'psycopg2-binary': 'PostgreSQL', 'asyncpg': 'PostgreSQL',
        'pymysql': 'MySQL', 'mysqlclient': 'MySQL', 'aiomysql': 'MySQL',
        'pymongo': 'MongoDB', 'motor': 'MongoDB',
        'redis': 'Redis', 'aioredis': 'Redis',
        'sqlite3': 'SQLite', 'aiosqlite': 'SQLite',
      };
      const dbSeen = new Set(ctx.databases);
      for (const [dep, label] of Object.entries(pyDbMap)) {
        if (allPyDeps.has(dep) && !dbSeen.has(label)) { ctx.databases.push(label); dbSeen.add(label); }
      }
      // SQLAlchemy
      if (allPyDeps.has('sqlalchemy') && !ctx.keyDependencies.includes('sqlalchemy')) {
        ctx.keyDependencies.push('sqlalchemy');
      }

      // Conventions
      if (!ctx.conventions.naming) ctx.conventions.naming = 'snake_case (Python)';

      // Entry points
      if (ctx.entryPoints.length === 0) {
        for (const f of ['src/main.py', 'main.py', 'app.py', 'manage.py', 'run.py', 'cli.py']) {
          if (fsh.exists(path.join(ctx.cwd, f))) { ctx.entryPoints.push(f); break; }
        }
        // Django manage.py
        if (fsh.exists(path.join(ctx.cwd, 'manage.py')) && !ctx.entryPoints.includes('manage.py')) {
          ctx.entryPoints.push('manage.py');
        }
      }

      // Python src layout detection
      if (!ctx.directories.src) {
        const pySrcDir = path.join(ctx.cwd, 'src');
        if (fsh.exists(pySrcDir)) {
          ctx.directories.src = 'src';
        } else if (ctx.projectName) {
          const pkgDir = path.join(ctx.cwd, ctx.projectName.replace(/-/g, '_'));
          if (fsh.exists(pkgDir)) ctx.directories.src = ctx.projectName.replace(/-/g, '_');
        }
      }
    } catch { /* ignore */ }
  },
};
