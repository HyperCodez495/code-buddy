import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { collectInstalledRuntimePackagePaths, prepareCoreRuntime } = require(
  '../../scripts/prepare-core-runtime.js',
) as {
  collectInstalledRuntimePackagePaths: (
    coreRoot: string,
    options?: { platform?: string; arch?: string; includeRootOptional?: boolean },
  ) => string[];
  prepareCoreRuntime: (options: {
    coreRoot: string;
    coworkRoot: string;
    runtimeRoot: string;
    platform?: string;
    arch?: string;
    includeRootOptional?: boolean;
    useCoworkNativeOverrides?: boolean;
  }) => {
    runtimeRoot: string;
    packagePaths: string[];
    manifest: { nativeOverrides: string[] };
  };
};

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-runtime-test-'));
  temporaryRoots.push(root);
  return root;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writePackage(root: string, packagePath: string, packageJson: object, index = ''): void {
  writeFile(path.join(root, packagePath, 'package.json'), JSON.stringify(packageJson));
  if (index) writeFile(path.join(root, packagePath, 'index.js'), index);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('collectInstalledRuntimePackagePaths', () => {
  function dependencyFixture(): string {
    const root = temporaryRoot();
    writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        dependencies: { 'fixture-a': '1.0.0' },
        optionalDependencies: { 'fixture-root-optional': '1.0.0' },
      }),
    );
    writePackage(root, 'node_modules/fixture-a', {
      dependencies: { 'fixture-b': '1.0.0' },
      optionalDependencies: { 'fixture-linux-helper': '1.0.0' },
    });
    writePackage(root, 'node_modules/fixture-b', {});
    writePackage(root, 'node_modules/fixture-linux-helper', {
      os: ['linux'],
      cpu: ['x64'],
    });
    writePackage(root, 'node_modules/fixture-root-optional', {});
    return root;
  }

  it('keeps the required closure and platform helpers without seeding root optional features', () => {
    expect(
      collectInstalledRuntimePackagePaths(dependencyFixture(), {
        platform: 'linux',
        arch: 'x64',
      }),
    ).toEqual([
      'node_modules/fixture-a',
      'node_modules/fixture-b',
      'node_modules/fixture-linux-helper',
    ]);
  });

  it('can include root optional features explicitly and filters foreign native targets', () => {
    expect(
      collectInstalledRuntimePackagePaths(dependencyFixture(), {
        platform: 'darwin',
        arch: 'arm64',
        includeRootOptional: true,
      }),
    ).toEqual([
      'node_modules/fixture-a',
      'node_modules/fixture-b',
      'node_modules/fixture-root-optional',
    ]);
  });
});

describe('prepareCoreRuntime', () => {
  it('fails closed instead of packaging host-native bindings for another architecture', () => {
    const root = temporaryRoot();
    const targetArch = process.arch === 'x64' ? 'arm64' : 'x64';

    expect(() =>
      prepareCoreRuntime({
        coreRoot: path.join(root, 'core'),
        coworkRoot: path.join(root, 'cowork'),
        runtimeRoot: path.join(root, 'runtime'),
        platform: process.platform,
        arch: targetArch,
      }),
    ).toThrow(/Cross-target core runtime staging is unsafe/);
  });

  it('creates an isolated ESM runtime whose bare dependency resolves outside the source tree', async () => {
    const root = temporaryRoot();
    const coreRoot = path.join(root, 'core');
    const coworkRoot = path.join(root, 'cowork');
    const runtimeRoot = path.join(coworkRoot, '.bundle-resources', 'core-runtime');

    writeFile(
      path.join(coreRoot, 'package.json'),
      JSON.stringify({ dependencies: { 'fixture-a': '1.0.0' } }),
    );
    writeFile(
      path.join(coreRoot, 'dist', 'desktop', 'codebuddy-engine-adapter.js'),
      "import value from 'fixture-a'; if (value !== 42) throw new Error('bad dependency'); export class CodeBuddyEngineAdapter {}",
    );
    writePackage(
      coreRoot,
      'node_modules/fixture-a',
      { type: 'module', exports: './index.js', dependencies: { 'fixture-b': '1.0.0' } },
      "import value from 'fixture-b'; export default value + 1;",
    );
    writePackage(
      coreRoot,
      'node_modules/fixture-b',
      { type: 'module', exports: './index.js' },
      'export default 41;',
    );

    const result = prepareCoreRuntime({
      coreRoot,
      coworkRoot,
      runtimeRoot,
      platform: 'linux',
      arch: 'x64',
      useCoworkNativeOverrides: false,
    });

    expect(result.packagePaths).toEqual([
      'node_modules/fixture-a',
      'node_modules/fixture-b',
    ]);
    expect(
      JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'dist', 'package.json'), 'utf8')),
    ).toMatchObject({ type: 'module' });
    await expect(
      import(
        `${pathToFileURL(
          path.join(runtimeRoot, 'dist', 'desktop', 'codebuddy-engine-adapter.js'),
        ).href}?test=${Date.now()}`
      ),
    ).resolves.toMatchObject({ CodeBuddyEngineAdapter: expect.any(Function) });
  });

  it('replaces the host-Node SQLite build with Cowork\'s Electron binding', () => {
    const root = temporaryRoot();
    const coreRoot = path.join(root, 'core');
    const coworkRoot = path.join(root, 'cowork');
    const runtimeRoot = path.join(coworkRoot, '.bundle-resources', 'core-runtime');
    writeFile(
      path.join(coreRoot, 'package.json'),
      JSON.stringify({ dependencies: { 'better-sqlite3': '1.0.0' } }),
    );
    writeFile(
      path.join(coreRoot, 'dist', 'desktop', 'codebuddy-engine-adapter.js'),
      'export class CodeBuddyEngineAdapter {}',
    );
    writePackage(coreRoot, 'node_modules/better-sqlite3', { version: 'node-build' });
    writeFile(
      path.join(
        coreRoot,
        'node_modules',
        'better-sqlite3',
        'build',
        'Release',
        'better_sqlite3.node',
      ),
      'node-abi',
    );
    writePackage(coworkRoot, 'node_modules/better-sqlite3', { version: 'electron-build' });
    writeFile(
      path.join(
        coworkRoot,
        'node_modules',
        'better-sqlite3',
        'build',
        'Release',
        'better_sqlite3.node',
      ),
      'electron-abi',
    );

    const result = prepareCoreRuntime({ coreRoot, coworkRoot, runtimeRoot });

    expect(result.manifest.nativeOverrides).toEqual(['better-sqlite3']);
    expect(
      fs.readFileSync(
        path.join(
          runtimeRoot,
          'node_modules',
          'better-sqlite3',
          'build',
          'Release',
          'better_sqlite3.node',
        ),
        'utf8',
      ),
    ).toBe('electron-abi');
  });
});
