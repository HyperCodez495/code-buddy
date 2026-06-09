/**
 * demo-tour — records short Cowork videos for the docs, one per use-case scene.
 *
 * On-demand only (RECORD_DEMO=1): each scene launches Cowork with `recordVideo`
 * (the only way to capture an Electron window — `use.video` does NOT apply to
 * _electron.launch), dismisses the first-run onboarding, then walks that scene's
 * panels. Each webm lands under cowork/demo-video/<scene>/.
 *
 *   RECORD_DEMO=1 npx playwright test e2e/demo-tour.spec.ts
 */
import { _electron as electron, test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import electronBinary from 'electron';

async function launchCowork(videoDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'cowork-demo-'));
  const modelPath = path.join(userDataDir, 'models', 'buffalo_s.onnx');
  mkdirSync(path.dirname(modelPath), { recursive: true });
  writeFileSync(modelPath, '');

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

  // Dismiss the first-run onboarding wizard (fresh userDataDir → it's shown).
  const onboarding = page.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 2500 }).catch(() => false)) {
    await page.getByTestId('onboarding-skip').click().catch(() => {});
    await expect(onboarding).toHaveCount(0).catch(() => {});
  }
  await page.waitForTimeout(1200);
  return { app, page };
}

async function visit(page: Page, ids: string[], pauseMs = 1600): Promise<void> {
  for (const id of ids) {
    try {
      await page.getByTestId(id).click({ timeout: 4000 });
      await page.waitForTimeout(pauseMs);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(450);
    } catch {
      // skip missing/disabled stop, keep recording
    }
  }
}

// One video per scene → covers a maximum of use cases.
const SCENES: Record<string, string[]> = {
  // Multi-AI fleet: spawn a team, command center, peer events, agent team, devices.
  fleet: ['orchestrator-button', 'fleet-command-center-button', 'fleet-panel-button', 'team-panel-button', 'devices-button'],
  // The agent's "brain": autonomous queue, persistent memory, reasoning traces.
  intelligence: ['autonomy-panel-button', 'memory-panel-button', 'reasoning-viewer-button'],
  // Companion: voice/vision/presence + delivery channels + mobile supervision.
  companion: ['companion-panel-button', 'channels-button', 'mobile-supervision-button'],
  // Insights & learning: activity, session insights, test runner, lessons, user model, spec, bookmarks, focus.
  insights: ['activity-button', 'session-insights-button', 'test-runner-button', 'lesson-candidate-button', 'user-model-button', 'spec-panel-button', 'bookmarks-button', 'focus-view-button'],
  // Automation: the mission board and desktop snapshot surfaces.
  automation: ['mission-board-button', 'desktop-snapshot-button'],
};

for (const [scene, ids] of Object.entries(SCENES)) {
  test(`demo ${scene}`, async () => {
    test.skip(!process.env.RECORD_DEMO, 'set RECORD_DEMO=1 to record demo videos');
    const dir = path.resolve('demo-video', scene);
    const { app, page } = await launchCowork(dir);
    await page.waitForTimeout(1000);
    await visit(page, ids);
    await page.waitForTimeout(1200);
    const video = page.video();
    await app.close();
    // eslint-disable-next-line no-console
    if (video) console.log(`SCENE ${scene}=${await video.path()}`);
  });
}

// Settings: the regrouped 7-section sidebar + a few tabs (not overlay → no Escape).
test('demo settings', async () => {
  test.skip(!process.env.RECORD_DEMO, 'set RECORD_DEMO=1 to record demo videos');
  const dir = path.resolve('demo-video', 'settings');
  const { app, page } = await launchCowork(dir);
  await page.getByTestId('shell-settings-button').click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1500);
  for (const tab of ['settings-tab-codebuddy', 'settings-tab-connectors', 'settings-tab-skills', 'settings-tab-rules', 'settings-tab-workflows']) {
    await page.getByTestId(tab).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1300);
  }
  const video = page.video();
  await app.close();
  // eslint-disable-next-line no-console
  if (video) console.log(`SCENE settings=${await video.path()}`);
});

// Orchestrator: the multi-agent team spawner (the wow shot) + the Agent Team.
test('demo orchestrator', async () => {
  test.skip(!process.env.RECORD_DEMO, 'set RECORD_DEMO=1 to record demo videos');
  const dir = path.resolve('demo-video', 'orchestrator');
  const { app, page } = await launchCowork(dir);
  await page.getByTestId('orchestrator-button').click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(3200); // linger on the "Spawn a multi-agent team" form
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
  await page.getByTestId('team-panel-button').click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(2600);
  const video = page.video();
  await app.close();
  // eslint-disable-next-line no-console
  if (video) console.log(`SCENE orchestrator=${await video.path()}`);
});

// Extensibility: the Workflows DAG editor, MCP connectors/marketplace, Skills, Plugins.
test('demo extensibility', async () => {
  test.skip(!process.env.RECORD_DEMO, 'set RECORD_DEMO=1 to record demo videos');
  const dir = path.resolve('demo-video', 'extensibility');
  const { app, page } = await launchCowork(dir);
  await page.getByTestId('shell-settings-button').click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1200);
  for (const tab of ['settings-tab-workflows', 'settings-tab-connectors', 'settings-tab-mcpMarketplace', 'settings-tab-skills', 'settings-tab-skillsBrowser', 'settings-tab-plugins', 'settings-tab-hooks']) {
    await page.getByTestId(tab).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  const video = page.video();
  await app.close();
  // eslint-disable-next-line no-console
  if (video) console.log(`SCENE extensibility=${await video.path()}`);
});
