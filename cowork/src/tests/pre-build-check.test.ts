import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

// Import the runChecks function from the CommonJS script using createRequire
const require = createRequire(import.meta.url);
const { runChecks, validateCoreRuntimeManifest } = require('../../scripts/pre-build-check.js');
const { computeDistDigest } = require('../../../scripts/runtime-manifest-utils.cjs') as {
  computeDistDigest: (root: string) => {
    algorithm: string;
    scope: string;
    value: string;
    fileCount: number;
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pre-build-check-test-'));
}

function makeFile(filePath: string, content: string = '// placeholder'): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function makeDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Self-contained staged Code Buddy runtime. The adapter deliberately imports a
 * fake `chalk` package from the sibling node_modules so runChecks exercises the
 * same bare-ESM lookup used in packaged resources, not just file existence.
 */
function populateEngineAdapter(root: string): void {
  const runtime = path.join(root, '.bundle-resources', 'core-runtime');
  makeFile(
    path.join(runtime, 'dist', 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  makeFile(
    path.join(runtime, 'dist', 'desktop', 'codebuddy-engine-adapter.js'),
    "import chalk from 'chalk'; if (chalk.blue('ok') !== 'ok') throw new Error('bad chalk'); export class CodeBuddyEngineAdapter {}",
  );
  makeFile(
    path.join(runtime, 'dist', 'conversation', 'relationship-safety.js'),
    'export class RelationshipSafetyStreamGuard {}',
  );
  makeFile(
    path.join(runtime, 'dist', 'agent', 'codebuddy-agent.js'),
    "import chalk from 'chalk'; export class CodeBuddyAgent { color = chalk.blue('ok'); }",
  );
  makeFile(
    path.join(runtime, 'node_modules', 'chalk', 'package.json'),
    JSON.stringify({ type: 'module', exports: './index.js' }),
  );
  makeFile(
    path.join(runtime, 'node_modules', 'chalk', 'index.js'),
    "export default { blue(value) { return value; } };",
  );
  makeFile(
    path.join(
      runtime,
      'node_modules',
      'better-sqlite3',
      'build',
      'Release',
      'better_sqlite3.node',
    ),
  );
  makeFile(
    path.join(runtime, 'codebuddy-runtime.json'),
    JSON.stringify({
      schemaVersion: 2,
      corePackage: {
        name: '@phuetz/code-buddy',
        version: '1.8.0',
        description: 'Compiled Code Buddy test runtime',
      },
      sourceRevision: null,
      sourceDirty: null,
      distDigest: computeDistDigest(runtime),
      runtime: {
        kind: 'codebuddy-core',
        compiled: true,
        moduleFormat: 'esm',
        distPath: 'dist',
        entrypoint: 'dist/desktop/codebuddy-engine-adapter.js',
      },
      platform: 'test',
      arch: 'x64',
      packageCount: 2,
    }),
  );
}

function populateSqliteBinding(root: string): void {
  makeFile(
    path.join(root, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
  );
}

/**
 * Creates all artifacts that are required for a successful darwin/arm64 check.
 */
function populateDarwinArtifacts(root: string, arch: string = 'arm64'): void {
  // Common FATAL resources
  makeFile(path.join(root, '.bundle-resources/mcp/gui-operate-server.js'));
  makeFile(path.join(root, '.bundle-resources/mcp/software-dev-server-example.js'));
  makeDir(path.join(root, 'dist-electron'));
  makeDir(path.join(root, 'dist'));
  makeDir(path.join(root, '.claude/skills'));
  populateSqliteBinding(root);
  populateEngineAdapter(root);

  // macOS FATAL resources
  makeFile(path.join(root, `resources/node/darwin-${arch}/bin/node`));
  makeFile(path.join(root, 'dist-lima-agent/index.js'));
}

/**
 * Creates all artifacts that are required for a successful win32/x64 check.
 */
function populateWin32Artifacts(root: string): void {
  makeFile(path.join(root, '.bundle-resources/mcp/gui-operate-server.js'));
  makeFile(path.join(root, '.bundle-resources/mcp/software-dev-server-example.js'));
  makeDir(path.join(root, 'dist-electron'));
  makeDir(path.join(root, 'dist'));
  makeDir(path.join(root, '.claude/skills'));
  populateSqliteBinding(root);
  populateEngineAdapter(root);
  makeFile(path.join(root, 'resources/node/win32-x64/node.exe'));
  makeFile(path.join(root, 'dist-wsl-agent/index.js'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pre-build-check: runChecks', () => {
  let parentDir: string;
  let tmpDir: string;

  beforeEach(() => {
    // Keep the fixture shaped like the real cowork project so all relative
    // resource paths are exercised without leaking files into /tmp.
    parentDir = makeTempDir();
    tmpDir = path.join(parentDir, 'cowork');
    fs.mkdirSync(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // All-pass scenarios
  // -------------------------------------------------------------------------

  it('passes all FATAL checks on darwin when required artifacts exist', () => {
    populateDarwinArtifacts(tmpDir, 'arm64');

    const result = runChecks(tmpDir, 'darwin', 'arm64');

    expect(result.failed).toBe(0);
    expect(result.hasFatal).toBe(false);
    // 6 common (incl. engine adapter) + 2 darwin FATAL = 8 FATAL checks should pass
    expect(result.passed).toBeGreaterThanOrEqual(8);
  });

  it('passes all FATAL checks on win32 when required artifacts exist', () => {
    populateWin32Artifacts(tmpDir);

    const result = runChecks(tmpDir, 'win32', 'x64');

    expect(result.failed).toBe(0);
    expect(result.hasFatal).toBe(false);
    expect(result.passed).toBeGreaterThanOrEqual(8);
  });

  it('reports warnings for optional darwin resources that are missing', () => {
    // Only populate FATAL items; leave warn items absent
    populateDarwinArtifacts(tmpDir, 'x64');

    const result = runChecks(tmpDir, 'darwin', 'x64');

    expect(result.failed).toBe(0);
    expect(result.hasFatal).toBe(false);
    // Both python and tools dirs are absent => 2 warnings
    expect(result.warnings).toBe(2);
  });

  it('reports zero warnings when optional darwin resources are present', () => {
    populateDarwinArtifacts(tmpDir, 'x64');
    makeDir(path.join(tmpDir, 'resources/python/darwin-x64'));
    makeDir(path.join(tmpDir, 'resources/tools/darwin-x64'));

    const result = runChecks(tmpDir, 'darwin', 'x64');

    expect(result.failed).toBe(0);
    expect(result.warnings).toBe(0);
    expect(result.hasFatal).toBe(false);
  });

  it('treats missing built-in skills as warning instead of blocking packaging', () => {
    populateWin32Artifacts(tmpDir);
    fs.rmSync(path.join(tmpDir, '.claude/skills'), { recursive: true });

    const result = runChecks(tmpDir, 'win32', 'x64');
    const skillsCheck = result.results.find(
      (r: { relPath: string; severity: string }) => r.relPath === '.claude/skills'
    );

    expect(skillsCheck).toMatchObject({
      passed: false,
      severity: 'warn',
    });
    expect(result.failed).toBe(0);
    expect(result.warnings).toBe(1);
    expect(result.hasFatal).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Failure scenarios
  // -------------------------------------------------------------------------

  it('rejects a runtime manifest that attests an unrelated package', () => {
    const manifestPath = path.join(tmpDir, 'codebuddy-runtime.json');
    makeFile(manifestPath, JSON.stringify({
      schemaVersion: 2,
      corePackage: {
        name: '@evil/code-buddy',
        version: '1.0.0',
        description: 'not the core',
      },
    }));

    expect(validateCoreRuntimeManifest(manifestPath)).toMatchObject({
      valid: false,
      detail: expect.stringContaining('Unexpected Code Buddy core package name'),
    });
  });

  it('rejects a staged runtime whose unhashed ESM marker was altered', () => {
    populateWin32Artifacts(tmpDir);
    const runtime = path.join(tmpDir, '.bundle-resources', 'core-runtime');
    makeFile(
      path.join(runtime, 'dist', 'package.json'),
      JSON.stringify({ private: true, type: 'commonjs', main: '../outside.js' }),
    );

    const result = validateCoreRuntimeManifest(path.join(runtime, 'codebuddy-runtime.json'));

    expect(result).toMatchObject({
      valid: false,
      detail: expect.stringContaining('private ESM marker'),
    });
  });

  it('reports hasFatal when a common FATAL file is missing', () => {
    populateDarwinArtifacts(tmpDir, 'arm64');
    // Remove a required common file
    fs.rmSync(path.join(tmpDir, '.bundle-resources/mcp/gui-operate-server.js'));

    const result = runChecks(tmpDir, 'darwin', 'arm64');

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it('blocks packaging when the companion relationship gate is missing', () => {
    populateWin32Artifacts(tmpDir);
    fs.rmSync(
      path.join(
        tmpDir,
        '.bundle-resources',
        'core-runtime',
        'dist',
        'conversation',
        'relationship-safety.js',
      ),
    );

    const result = runChecks(tmpDir, 'win32', 'x64');
    const safety = result.results.find((entry: { relPath: string }) =>
      entry.relPath.includes('conversation/relationship-safety.js')
    );
    expect(safety).toMatchObject({ passed: false, severity: 'fatal' });
    expect(result.hasFatal).toBe(true);
  });

  it('blocks packaging when the core runtime manifest has no compiled identity proof', () => {
    populateWin32Artifacts(tmpDir);
    const manifestPath = path.join(
      tmpDir,
      '.bundle-resources',
      'core-runtime',
      'codebuddy-runtime.json',
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      corePackage: { version?: string };
    };
    delete manifest.corePackage.version;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = runChecks(tmpDir, 'win32', 'x64');
    const runtimeManifest = result.results.find((entry: { relPath: string }) =>
      entry.relPath.endsWith('codebuddy-runtime.json')
    );

    expect(runtimeManifest).toMatchObject({ passed: false, severity: 'fatal' });
    expect((runtimeManifest as { detail?: string }).detail).toContain('corePackage.version');
    expect(result.hasFatal).toBe(true);
  });

  it('blocks packaging when the staged adapter cannot resolve a bare ESM dependency', () => {
    populateWin32Artifacts(tmpDir);
    fs.rmSync(
      path.join(tmpDir, '.bundle-resources', 'core-runtime', 'node_modules', 'chalk'),
      { recursive: true },
    );

    const result = runChecks(tmpDir, 'win32', 'x64');
    const adapter = result.results.find((entry: { relPath: string }) =>
      entry.relPath.endsWith('desktop/codebuddy-engine-adapter.js')
    );

    expect(adapter).toMatchObject({ passed: false, severity: 'fatal' });
    expect((adapter as { detail?: string }).detail).toContain('chalk');
    expect(result.hasFatal).toBe(true);
  });

  it('reports hasFatal when dist-electron directory is missing', () => {
    populateDarwinArtifacts(tmpDir, 'arm64');
    fs.rmSync(path.join(tmpDir, 'dist-electron'), { recursive: true });

    const result = runChecks(tmpDir, 'darwin', 'arm64');

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it('reports hasFatal when better-sqlite3 Electron binding is missing', () => {
    populateWin32Artifacts(tmpDir);
    fs.rmSync(path.join(tmpDir, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'));

    const result = runChecks(tmpDir, 'win32', 'x64');
    const sqliteCheck = result.results.find(
      (r: { relPath: string; severity: string }) =>
        r.relPath === 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'
    );

    expect(sqliteCheck).toMatchObject({
      passed: false,
      severity: 'fatal',
    });
    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it('reports hasFatal when darwin node binary is missing', () => {
    populateDarwinArtifacts(tmpDir, 'arm64');
    fs.rmSync(path.join(tmpDir, 'resources/node/darwin-arm64/bin/node'));

    const result = runChecks(tmpDir, 'darwin', 'arm64');

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it('reports hasFatal when win32 node.exe is missing', () => {
    populateWin32Artifacts(tmpDir);
    fs.rmSync(path.join(tmpDir, 'resources/node/win32-x64/node.exe'));

    const result = runChecks(tmpDir, 'win32', 'x64');

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it('reports hasFatal when wsl-agent index.js is missing', () => {
    populateWin32Artifacts(tmpDir);
    fs.rmSync(path.join(tmpDir, 'dist-wsl-agent/index.js'));

    const result = runChecks(tmpDir, 'win32', 'x64');

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it('reports hasFatal when lima-agent index.js is missing', () => {
    populateDarwinArtifacts(tmpDir, 'arm64');
    fs.rmSync(path.join(tmpDir, 'dist-lima-agent/index.js'));

    const result = runChecks(tmpDir, 'darwin', 'arm64');

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it('fails all checks when root directory is completely empty', () => {
    const result = runChecks(tmpDir, 'darwin', 'arm64');

    // All checks should fail or warn; none should pass
    expect(result.passed).toBe(0);
    expect(result.hasFatal).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Result shape
  // -------------------------------------------------------------------------

  it('returns a results array with one entry per check', () => {
    populateDarwinArtifacts(tmpDir, 'arm64');

    const result = runChecks(tmpDir, 'darwin', 'arm64');

    expect(Array.isArray(result.results)).toBe(true);
    // Each result must have required fields
    for (const r of result.results) {
      expect(typeof r.label).toBe('string');
      expect(typeof r.relPath).toBe('string');
      expect(typeof r.passed).toBe('boolean');
      expect(['fatal', 'warn']).toContain(r.severity);
    }
  });

  it('passed + warnings + failed sums equal total checks', () => {
    populateDarwinArtifacts(tmpDir, 'arm64');

    const result = runChecks(tmpDir, 'darwin', 'arm64');

    expect(result.passed + result.warnings + result.failed).toBe(result.results.length);
  });

  // -------------------------------------------------------------------------
  // Linux platform
  // -------------------------------------------------------------------------

  it('includes linux-specific check on linux platform', () => {
    const result = runChecks(tmpDir, 'linux', 'x64');

    const linuxCheck = result.results.find(
      (r: { relPath: string; severity: string }) => r.relPath === 'resources/node/linux-x64'
    );
    expect(linuxCheck).toBeDefined();
    expect(linuxCheck?.severity).toBe('fatal');
  });
});
