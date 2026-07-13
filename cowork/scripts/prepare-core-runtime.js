/**
 * Prepare a self-contained Code Buddy core runtime for electron-builder.
 *
 * The packaged core is loaded from `<resources>/dist`. Node resolves bare ESM
 * imports relative to that physical directory, so dependencies hidden in
 * `app.asar/node_modules` are not visible. This script stages the complete
 * compiled core next to the production dependency closure it needs:
 *
 *   .bundle-resources/core-runtime/
 *     dist/
 *     node_modules/
 *
 * Files are hard-linked when possible (copy fallback), keeping staging fast and
 * space-efficient while electron-builder still receives ordinary files. We do
 * not bundle the core: Cowork dynamically imports many independent core modules
 * and several dependencies ship native binaries/assets that bundlers cannot
 * safely flatten.
 *
 * Root optionalDependencies are deliberately not seeded. They remain optional
 * capabilities, while every dependency (including optional platform helpers)
 * reachable from a required production package is included. Set
 * CODEBUDDY_CORE_INCLUDE_OPTIONAL=1 for a full, larger runtime. Native core
 * staging intentionally fails closed for cross-platform/architecture builds:
 * package on the target host so Electron bindings and optional binaries match.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RUNTIME_SCHEMA_VERSION = 1;
const CORE_RUNTIME_RELATIVE_PATH = path.join('.bundle-resources', 'core-runtime');

function configuredTargetArch(platform) {
  if (platform === 'darwin') return 'arm64';
  if (platform === 'win32' || platform === 'linux') return 'x64';
  return process.arch;
}

function packageParent(packagePath) {
  const match = packagePath.match(/^(.*?)(?:\/)?node_modules\/(?:@[^/]+\/)?[^/]+$/);
  return match ? match[1].replace(/\/$/, '') : '';
}

function supportsValue(values, value) {
  if (!Array.isArray(values) || values.length === 0) return true;
  if (values.includes(`!${value}`)) return false;
  const positive = values.filter((entry) => !entry.startsWith('!'));
  return positive.length === 0 || positive.includes(value);
}

function supportsCurrentTarget(entry, platform, arch) {
  return supportsValue(entry.os, platform) && supportsValue(entry.cpu, arch);
}

function resolveInstalledDependencyPath(coreRoot, fromPackagePath, dependencyName) {
  let cursor = fromPackagePath;
  while (true) {
    const candidate = cursor
      ? `${cursor}/node_modules/${dependencyName}`
      : `node_modules/${dependencyName}`;
    if (fs.existsSync(path.join(coreRoot, candidate, 'package.json'))) return candidate;
    if (!cursor) return null;
    const parent = packageParent(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

/**
 * Walk the dependency graph that is actually installed on the packaging host.
 * A clean CI install matches package-lock exactly; using installed package.json
 * files also makes local packaging tolerant of a lockfile updated slightly
 * ahead of node_modules, without copying unrelated development dependencies.
 */
function collectInstalledRuntimePackagePaths(coreRoot, options = {}) {
  const platform =
    options.platform ?? process.env.CODEBUDDY_CORE_TARGET_PLATFORM ?? process.platform;
  const arch =
    options.arch ??
    process.env.CODEBUDDY_CORE_TARGET_ARCH ??
    configuredTargetArch(platform);
  const includeRootOptional = options.includeRootOptional === true;
  const rootPackagePath = path.join(coreRoot, 'package.json');
  if (!fs.existsSync(rootPackagePath)) {
    throw new Error(`Code Buddy package manifest is missing: ${rootPackagePath}`);
  }
  const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));
  const queue = [];
  const included = new Set();

  const enqueueRootGroup = (group, required) => {
    for (const dependencyName of Object.keys(group ?? {})) {
      const resolved = resolveInstalledDependencyPath(coreRoot, '', dependencyName);
      if (resolved) queue.push(resolved);
      else if (required) {
        throw new Error(`Installed production dependency is missing: ${dependencyName} (run npm install)`);
      }
    }
  };
  enqueueRootGroup(rootPackage.dependencies, true);
  if (includeRootOptional) enqueueRootGroup(rootPackage.optionalDependencies, false);

  while (queue.length > 0) {
    const packagePath = queue.pop();
    if (!packagePath || included.has(packagePath)) continue;
    const packageJsonPath = path.join(coreRoot, packagePath, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (!supportsCurrentTarget(packageJson, platform, arch)) continue;
    included.add(packagePath);

    const enqueueGroup = (group, required) => {
      for (const dependencyName of Object.keys(group ?? {})) {
        const resolved = resolveInstalledDependencyPath(coreRoot, packagePath, dependencyName);
        if (resolved) queue.push(resolved);
        else if (required) {
          throw new Error(
            `Installed dependency ${dependencyName} required by ${packagePath} is missing (run npm install)`,
          );
        }
      }
    };
    enqueueGroup(packageJson.dependencies, true);
    enqueueGroup(packageJson.optionalDependencies, false);
    enqueueGroup(packageJson.peerDependencies, false);
  }

  return [...included].sort((left, right) => {
    const depthDelta = left.split('/node_modules/').length - right.split('/node_modules/').length;
    return depthDelta || left.localeCompare(right);
  });
}

function copyTreeWithHardlinks(source, destination, options = {}) {
  const sourceStat = fs.lstatSync(source);
  if (sourceStat.isSymbolicLink()) {
    // Dereference install-time links. Absolute links back into the developer's
    // node_modules would be broken after packaging, and creating symlinks often
    // requires elevated privileges on Windows.
    copyTreeWithHardlinks(fs.realpathSync(source), destination, options);
    return;
  }
  if (sourceStat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      if (options.excludeNestedNodeModules && entry.isDirectory() && entry.name === 'node_modules') {
        continue;
      }
      copyTreeWithHardlinks(
        path.join(source, entry.name),
        path.join(destination, entry.name),
        options,
      );
    }
    return;
  }
  if (!sourceStat.isFile()) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try {
    fs.linkSync(source, destination);
  } catch (error) {
    if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error;
    fs.copyFileSync(source, destination);
  }
}

function replacePackage(runtimeRoot, packageName, sourcePackagePath) {
  const destination = path.join(runtimeRoot, 'node_modules', ...packageName.split('/'));
  fs.rmSync(destination, { recursive: true, force: true });
  copyTreeWithHardlinks(sourcePackagePath, destination, { excludeNestedNodeModules: true });
}

function prepareCoreRuntime(options = {}) {
  const coworkRoot = path.resolve(options.coworkRoot ?? path.join(__dirname, '..'));
  const coreRoot = path.resolve(options.coreRoot ?? path.join(coworkRoot, '..'));
  const runtimeRoot = path.resolve(
    options.runtimeRoot ?? path.join(coworkRoot, CORE_RUNTIME_RELATIVE_PATH),
  );
  const platform =
    options.platform ?? process.env.CODEBUDDY_CORE_TARGET_PLATFORM ?? process.platform;
  const arch =
    options.arch ??
    process.env.CODEBUDDY_CORE_TARGET_ARCH ??
    configuredTargetArch(platform);
  const includeRootOptional =
    options.includeRootOptional ?? process.env.CODEBUDDY_CORE_INCLUDE_OPTIONAL === '1';
  const coreDist = path.join(coreRoot, 'dist');

  if (
    options.useCoworkNativeOverrides !== false &&
    (platform !== process.platform || arch !== process.arch)
  ) {
    throw new Error(
      `Cross-target core runtime staging is unsafe (${process.platform}/${process.arch} host -> ` +
        `${platform}/${arch} target): build Cowork on the target host so native dependencies match`,
    );
  }

  if (!fs.existsSync(path.join(coreDist, 'desktop', 'codebuddy-engine-adapter.js'))) {
    throw new Error(`Code Buddy core is not built: ${coreDist} (run npm run build at repo root)`);
  }
  const packagePaths = collectInstalledRuntimePackagePaths(coreRoot, {
    platform,
    arch,
    includeRootOptional,
  });

  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });
  copyTreeWithHardlinks(coreDist, path.join(runtimeRoot, 'dist'));
  fs.writeFileSync(
    path.join(runtimeRoot, 'dist', 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
  );

  for (const packagePath of packagePaths) {
    const source = path.join(coreRoot, packagePath);
    if (!fs.existsSync(source)) {
      throw new Error(`Installed production dependency is missing: ${source} (run npm install)`);
    }
    copyTreeWithHardlinks(source, path.join(runtimeRoot, packagePath), {
      excludeNestedNodeModules: true,
    });
  }

  // The root install is compiled for the host Node ABI. Embedded mode runs in
  // Electron, so use Cowork's postinstall-rebuilt package for this ABI-sensitive
  // native dependency. Its JS API is backward-compatible with core usage.
  if (options.useCoworkNativeOverrides !== false && packagePaths.includes('node_modules/better-sqlite3')) {
    const sqliteSource = path.join(coworkRoot, 'node_modules', 'better-sqlite3');
    const sqliteBinding = path.join(sqliteSource, 'build', 'Release', 'better_sqlite3.node');
    if (!fs.existsSync(sqliteBinding)) {
      throw new Error(
        `Cowork better-sqlite3 Electron binding is missing: ${sqliteBinding} (run npm run rebuild)`,
      );
    }
    replacePackage(runtimeRoot, 'better-sqlite3', sqliteSource);
  }

  const manifest = {
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    platform,
    arch,
    includeRootOptional,
    packageCount: packagePaths.length,
    nativeOverrides:
      options.useCoworkNativeOverrides === false || !packagePaths.includes('node_modules/better-sqlite3')
        ? []
        : ['better-sqlite3'],
  };
  fs.writeFileSync(
    path.join(runtimeRoot, 'codebuddy-runtime.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return { runtimeRoot, packagePaths, manifest };
}

function main() {
  try {
    const result = prepareCoreRuntime();
    console.log(
      `Prepared Code Buddy core runtime: ${result.runtimeRoot} (${result.packagePaths.length} packages)`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  CORE_RUNTIME_RELATIVE_PATH,
  collectInstalledRuntimePackagePaths,
  copyTreeWithHardlinks,
  prepareCoreRuntime,
};

if (require.main === module) main();
