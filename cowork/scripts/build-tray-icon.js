/**
 * Build the Windows tray icon (.ico) from the source PNG.
 *
 * The tray code at `cowork/src/main/window-management.ts:97` and
 * `cowork/src/main/index.ts:347` looks for `resources/tray-icon.ico`
 * on Windows and falls back to PNG otherwise. PNG works but renders
 * blurry on Windows (no DPI-aware sizing) — a real .ico with multiple
 * embedded resolutions (16, 24, 32, 48) gives crisp scaling on all
 * display densities.
 *
 * Idempotent: if `tray-icon.ico` is newer than the PNG, skip. If the PNG source
 * is absent but a committed/generated ICO already exists, skip as well; Windows
 * packaging uses the ICO directly and should not be blocked by the optional PNG
 * fallback asset.
 *
 * Run via `npm run build:tray-icon` (also wired into the `build` script
 * before electron-builder so packaged binaries always ship a fresh icon).
 *
 * @module cowork/scripts/build-tray-icon
 */

'use strict';

const fs = require('fs');
const path = require('path');

// `png-to-ico` is ESM-only since v3, so we load it via dynamic import
// from this CJS script. Cached after first call to avoid re-loading
// on idempotent runs.
async function loadPngToIco() {
  const mod = await import('png-to-ico');
  return mod.default;
}

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const SOURCE_PNG = path.join(RESOURCES_DIR, 'tray-icon.png');
const OUTPUT_ICO = path.join(RESOURCES_DIR, 'tray-icon.ico');

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

async function main() {
  if (!fs.existsSync(SOURCE_PNG)) {
    if (fs.existsSync(OUTPUT_ICO)) {
      console.log(`${YELLOW}[skip]${RESET} Source PNG missing; using existing tray-icon.ico`);
      return;
    }
    console.error(`${RED}[fail]${RESET} Source PNG missing: ${SOURCE_PNG}`);
    process.exit(1);
  }

  // Up-to-date check: skip if .ico is newer than the source PNG.
  if (fs.existsSync(OUTPUT_ICO)) {
    const pngMtime = fs.statSync(SOURCE_PNG).mtimeMs;
    const icoMtime = fs.statSync(OUTPUT_ICO).mtimeMs;
    if (icoMtime >= pngMtime) {
      console.log(`${YELLOW}[skip]${RESET} tray-icon.ico is up-to-date`);
      return;
    }
  }

  try {
    const pngToIco = await loadPngToIco();
    const buffer = await pngToIco([SOURCE_PNG]);
    fs.writeFileSync(OUTPUT_ICO, buffer);
    const sizeKb = (buffer.length / 1024).toFixed(1);
    console.log(`${GREEN}[ok]${RESET}   tray-icon.ico generated (${sizeKb} KB)`);
  } catch (err) {
    console.error(`${RED}[fail]${RESET} Could not generate tray-icon.ico: ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${RED}[fail]${RESET} Unexpected error: ${err.stack || err.message}`);
  process.exit(1);
});
