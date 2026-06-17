// Installs the OPTIONAL "extras-tier" skill Python deps (markitdown, pandas,
// matplotlib, playwright) into the platform's bundled Python runtime at
// cowork/resources/python/<platform>. These are NOT part of the default build
// (see scripts/install-skill-python-deps.mjs for the lean default set).
//
// Run manually / opt-in:
//   npm run prepare:python:extras
//
// After pip-installing playwright, this also fetches the Firefox browser binary
// into a co-located cache (resources/python/<platform>/ms-playwright) so the
// web-automate skill works offline in the packaged app. The browser is a large
// download (~80MB) and lives OUTSIDE site-packages, hence PLAYWRIGHT_BROWSERS_PATH.
//
// No-ops cleanly if the bundled Python for the current platform isn't present.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coworkRoot = path.resolve(__dirname, '..');

const platform =
  process.platform === 'darwin'
    ? `darwin-${process.arch}`
    : process.platform === 'win32'
      ? 'win-x64'
      : 'linux-x64';

const pyDir = path.join(coworkRoot, 'resources', 'python', platform);
const python =
  process.platform === 'win32'
    ? path.join(pyDir, 'python.exe')
    : path.join(pyDir, 'bin', 'python3');
const requirements = path.join(
  coworkRoot,
  'resources',
  'python',
  'requirements-skills-extras.txt',
);
// Co-locate the Playwright browser cache with the bundled runtime so it ships
// with the app and resolves at runtime via PLAYWRIGHT_BROWSERS_PATH.
const browsersPath = path.join(pyDir, 'ms-playwright');

if (!existsSync(python)) {
  console.warn(
    `[skill-extras] bundled Python not found at ${python} — skipping. ` +
      `Extras-tier skills will require a system Python with the libs in requirements-skills-extras.txt.`,
  );
  process.exit(0);
}

console.log(`[skill-extras] installing optional extras deps into ${python}`);
try {
  execFileSync(
    python,
    ['-m', 'pip', 'install', '--no-input', '--disable-pip-version-check', '-r', requirements],
    { stdio: 'inherit' },
  );
} catch (err) {
  console.error('[skill-extras] pip install failed:', err?.message ?? err);
  process.exit(1);
}

// Fetch the Firefox browser binary for the web-automate skill (best-effort).
try {
  execFileSync(python, ['-c', 'import playwright'], { stdio: 'ignore' });
  console.log(`[skill-extras] fetching Playwright Firefox into ${browsersPath}`);
  execFileSync(python, ['-m', 'playwright', 'install', 'firefox'], {
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath },
  });
} catch (err) {
  console.warn(
    '[skill-extras] Playwright browser fetch skipped/failed ' +
      '(web-automate will prompt to run `python -m playwright install firefox`):',
    err?.message ?? err,
  );
}

console.log('[skill-extras] done.');
