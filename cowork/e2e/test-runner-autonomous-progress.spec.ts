import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function dismissOnboardingIfPresent(appPage: Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

async function mockAutonomousProgressRun(electronApp: ElectronApplication) {
  await electronApp.evaluate(({ ipcMain }) => {
    const startedAt = Date.UTC(2026, 5, 6, 8, 15, 0);
    const run = {
      runId: 'run_public_autonomous_progress',
      objective: 'Autonomous coding proof run',
      status: 'completed' as const,
      startedAt,
      endedAt: startedAt + 42_000,
      durationMs: 42_000,
      eventCount: 14,
      artifactCount: 2,
      source: 'autonomous-code',
      channel: 'autonomous-code',
      tags: ['agentic-coding', 'cowork-progress', 'public-proof'],
      toolCallCount: 3,
      totalCost: 0,
      totalTokens: 0,
      agenticProgress: {
        activeNodeId: 'verification',
        approvalState: 'not_required',
        blocked: 0,
        completed: 7,
        nextAction: {
          message: 'Run verification passed; review artifacts before commit.',
          nodeId: 'verification',
          type: 'complete',
        },
        pending: 0,
        ready: 0,
        status: 'verified',
        total: 7,
      },
    };

    ipcMain.removeHandler('audit.listRuns');
    ipcMain.removeHandler('audit.getRunDetail');
    ipcMain.handle('audit.listRuns', async () => [run]);
    ipcMain.handle('audit.getRunDetail', async () => ({
      ...run,
      artifacts: ['workflow-progress.json', 'agentic-coding-report.json'],
      events: [],
      metrics: {},
    }));
  });
}

test('shows autonomous coding progress in the executions tab', async ({
  appPage,
  electronApp,
  userDataDir,
}) => {
  test.setTimeout(120_000);

  await dismissOnboardingIfPresent(appPage);
  await mockAutonomousProgressRun(electronApp);

  const workdirResult = await appPage.evaluate(
    async (workspacePath) =>
      window.electronAPI?.invoke?.({
        type: 'workdir.set',
        payload: { path: workspacePath },
      }),
    userDataDir,
  );
  expect(workdirResult).toMatchObject({ success: true });

  await appPage.getByText('Outils').click();
  await appPage.getByText('Test Runner').click();
  await expect(appPage.getByRole('heading', { name: 'Tests & executions' })).toBeVisible();

  await appPage.getByTestId('test-runner-executions-tab').click();
  const progressCard = appPage.getByTestId('agentic-progress-run_public_autonomous_progress');
  await expect(progressCard).toBeVisible({ timeout: 20_000 });
  await expect(progressCard).toContainText('Autonomous');
  await expect(progressCard).toContainText('Status: verified');
  await expect(progressCard).toContainText('Progress: 7/7');
  await expect(progressCard).toContainText('verification');

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/110-test-runner-autonomous-progress.png',
    ),
    fullPage: true,
  });
});
