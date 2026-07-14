import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function installLauncherMock(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow, ipcMain }) => {
    for (const channel of [
      'liveLauncher.start',
      'liveLauncher.cancel',
      'liveLauncher.status',
      'liveLauncher.list',
      'autonomy.modelTier',
    ]) {
      ipcMain.removeHandler(channel);
    }

    let run: Record<string, unknown> | null = null;
    const send = (payload: Record<string, unknown>) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('server-event', {
        type: 'liveLauncher.event',
        payload,
      });
    };

    ipcMain.handle('autonomy.modelTier', async () => ({
      ok: true,
      ladder: [],
      currentChoice: {
        model: 'qwen3.6:27b',
        baseUrl: 'http://darkstar:11434/v1',
        tier: 'local',
        paid: false,
        reason: 'E2E local model',
      },
    }));
    ipcMain.handle('liveLauncher.list', async () => (run ? [run] : []));
    ipcMain.handle('liveLauncher.status', async () => run);
    ipcMain.handle('liveLauncher.cancel', async () => ({ ok: true }));
    ipcMain.handle('liveLauncher.start', async (_event, input: Record<string, unknown>) => {
      const runId = 'll_e2e_advanced';
      run = {
        runId,
        kind: input.kind,
        researchMode: input.deep ? 'deep' : input.wide ? 'wide' : 'direct',
        prompt: input.prompt,
        model: input.model,
        provider: input.provider,
        ollamaUrl: input.ollamaUrl,
        iterations: input.iterations,
        perspectives: input.perspectives,
        timeoutMs: 1_800_000,
        status: 'running',
        startedAt: Date.now(),
        reportPath: '/tmp/cowork-e2e-advanced-report.md',
        logTail: ['Plan de recherche créé'],
      };
      send({ runId, kind: 'status', run });
      setTimeout(() => {
        if (!run) return;
        run = {
          ...run,
          status: 'succeeded',
          endedAt: Date.now(),
          exitCode: 0,
          logTail: ['Plan de recherche créé', '4 perspectives analysées', 'Rapport finalisé'],
          result: '# Rapport E2E\n\nCENTRE_COMMANDE_OK : résultat administrable.',
        };
        send({ runId, kind: 'status', run });
      }, 150);
      return { ok: true, runId, reportPath: '/tmp/cowork-e2e-advanced-report.md' };
    });
  });
}

async function dismissTransientOverlays(appPage: Page): Promise<void> {
  await appPage.evaluate(() => localStorage.setItem('cowork.tourSeen', '1'));
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toBeHidden();
  }
  const tour = appPage.getByTestId('onboarding-tour');
  if (await tour.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await tour.getByRole('button', { name: 'Passer', exact: true }).click();
    await expect(tour).toBeHidden();
  }
}

test('advanced command center launches and administers a deep research result', async ({
  electronApp,
  appPage,
}) => {
  const runtimeErrors: string[] = [];
  appPage.on('pageerror', (error) => runtimeErrors.push(error.message));
  appPage.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await installLauncherMock(electronApp);
  await dismissTransientOverlays(appPage);
  await appPage.evaluate(() => {
    const store = (
      window as unknown as {
        useAppStore?: {
          getState: () => {
            setNewShellEnabled: (enabled: boolean) => void;
            setPrimaryView: (view: 'chat' | 'advanced') => void;
          };
        };
      }
    ).useAppStore?.getState();
    if (!store) throw new Error('useAppStore missing');
    store.setNewShellEnabled(true);
    store.setPrimaryView('chat');
  });
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(800, 600);
  });

  await expect(appPage.getByTestId('new-shell')).toBeVisible();
  await expect(appPage.getByTestId('rail-history')).toBeVisible();
  await appPage.getByTitle('Avancé', { exact: true }).click();
  await expect(appPage.getByTestId('advanced-command-center')).toBeVisible();
  await expect(appPage.getByRole('heading', { name: 'Fonctionnalités avancées' })).toBeVisible();
  expect(await appPage.title()).toBeTruthy();
  expect(appPage.url()).toMatch(/^file:/);
  await expect(appPage.locator('vite-error-overlay')).toHaveCount(0);

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1_400, 900);
  });

  await appPage.screenshot({
    path: path.join('/tmp', 'cowork-advanced-command-center-features.png'),
    fullPage: false,
  });

  await appPage.getByTestId('advanced-mode-research-deep').click();
  await appPage
    .getByTestId('advanced-launcher-prompt')
    .fill('Étudier la continuité des conversations multimodales');
  await expect(appPage.getByTestId('advanced-launcher-model')).toHaveValue('qwen3.6:27b');
  await expect(appPage.getByTestId('advanced-launcher-ollama-url')).toHaveValue(
    'http://darkstar:11434/v1',
  );
  await appPage.getByTestId('advanced-launcher-start').click();

  await expect(appPage.getByTestId('advanced-tab-runs')).toHaveAttribute('aria-selected', 'true');
  await expect(appPage.getByTestId('advanced-run-ll_e2e_advanced')).toBeVisible();
  await expect(appPage.getByTestId('advanced-run-result')).toContainText('CENTRE_COMMANDE_OK');
  await expect(appPage.getByTestId('advanced-run-log')).toContainText('Rapport finalisé');
  await expect(appPage.getByTestId('advanced-run-detail')).toContainText('Limite 30 min');
  await expect(appPage.getByTestId('advanced-run-rerun')).toBeEnabled();

  await appPage.screenshot({
    path: path.join('/tmp', 'cowork-advanced-command-center-desktop.png'),
    fullPage: false,
  });

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(900, 700);
  });
  await appPage.getByTestId('advanced-tab-features').click();
  await expect(appPage.getByTestId('advanced-launcher-prompt')).toBeVisible();
  await expect(appPage.getByText('Tous les modules')).toBeVisible();
  await appPage.screenshot({
    path: path.join('/tmp', 'cowork-advanced-command-center-responsive.png'),
    fullPage: false,
  });
  expect(runtimeErrors).toEqual([]);
});
