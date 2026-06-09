/**
 * demo-tour — records a short video of Cowork touring its main surfaces, for the
 * docs. Self-contained: it launches Electron with `recordVideo` (the only way to
 * capture an Electron window — `use.video` does NOT apply to _electron.launch),
 * walks the nav, then writes the webm path. Convert it for the README.
 *
 *   npx playwright test e2e/demo-tour.spec.ts
 *   → video under cowork/demo-video/*.webm
 */
import { _electron as electron, test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import electronBinary from 'electron';

test('cowork demo tour', async () => {
  // On-demand only — this records a video and is not a normal assertion test.
  test.skip(!process.env.RECORD_DEMO, 'set RECORD_DEMO=1 to record the demo video');
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'cowork-demo-'));
  const modelPath = path.join(userDataDir, 'models', 'buffalo_s.onnx');
  mkdirSync(path.dirname(modelPath), { recursive: true });
  writeFileSync(modelPath, '');
  const videoDir = path.resolve('demo-video');

  const app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    cwd: process.cwd(),
    args: ['e2e/electron-main.cjs', '--lang=en-US'],
    recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
    env: {
      ...process.env,
      COWORK_E2E: '1',
      COWORK_E2E_USER_DATA_DIR: userDataDir,
      CODEBUDDY_RUNS_DIR: path.join(userDataDir, 'codebuddy-runs'),
      CI: '1',
    },
  });

  const page = await app.firstWindow({ timeout: 60_000 });
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('app-root')).toBeVisible({ timeout: 30_000 });

  const pause = (ms = 1700) => page.waitForTimeout(ms);
  await pause(2200); // settle on the work surface

  const stops: Array<{ id: string; overlay: boolean }> = [
    { id: 'fleet-command-center-button', overlay: true },
    { id: 'team-panel-button', overlay: true },
    { id: 'autonomy-panel-button', overlay: true },
    { id: 'memory-panel-button', overlay: true },
    { id: 'reasoning-viewer-button', overlay: true },
    { id: 'companion-panel-button', overlay: true },
    { id: 'activity-button', overlay: true },
    { id: 'shell-settings-button', overlay: false },
  ];

  for (const stop of stops) {
    try {
      await page.getByTestId(stop.id).click({ timeout: 4000 });
      await pause();
      if (stop.overlay) {
        await page.keyboard.press('Escape').catch(() => {});
        await pause(500);
      }
    } catch {
      // skip missing/disabled stop, keep recording
    }
  }

  await page.getByTestId('app-root').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await pause(1500);

  const video = page.video();
  await app.close(); // finalizes the recording
  if (video) {
    // eslint-disable-next-line no-console
    console.log(`DEMO_VIDEO_PATH=${await video.path()}`);
  }
});
