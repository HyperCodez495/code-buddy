import { expect, test } from './fixtures';

async function completeOnboardingForTest(appPage) {
  await appPage.evaluate(async () => {
    await window.electronAPI?.config?.save?.({
      onboardingCompleted: true,
    });
  });

  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible().catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toBeHidden();
  }
}

test('opens AutonomyPanel and verifies LiveBudgetMeter and Subagent active gauges', async ({ appPage, electronApp }) => {
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('cost.summary');
    ipcMain.handle('cost.summary', async () => ({
      totalCost: 15.5,
      sessionCost: 0.5,
      dailyCost: 2.0,
      dailyLimit: 5.0,
    }));
    
    // Autonomy API mocks
    ipcMain.removeHandler('autonomy.snapshot');
    ipcMain.handle('autonomy.snapshot', async () => ({
      ok: true,
      dir: '/tmp/queue',
      tasks: [],
      worklog: [],
      presence: {
        'agent-1': { status: 'active', currentTask: 'Researching' },
        'agent-2': { status: 'idle', currentTask: null }
      }
    }));
    ipcMain.removeHandler('autonomy.daemonStatus');
    ipcMain.handle('autonomy.daemonStatus', async () => ({
      ok: true,
      serviceName: 'codebuddy-autonomy',
      service: { installed: true, running: true, platform: 'linux' },
      queueDir: '/tmp/queue',
      manageCommand: 'npm run start'
    }));
    ipcMain.removeHandler('autonomy.modelTier');
    ipcMain.handle('autonomy.modelTier', async () => ({
      ok: true,
      ladder: [],
    }));
  });

  await completeOnboardingForTest(appPage);

  await appPage.getByText('Outils').click();
  await appPage.getByText('Autonomie').click();

  const panel = appPage.getByTestId('autonomy-panel');
  await expect(panel).toBeVisible({ timeout: 10_000 });

  const budgetMeter = panel.getByTestId('live-budget-meter');
  await expect(budgetMeter).toBeVisible();
  
  await expect(budgetMeter).toContainText('$0.50');

  await expect(panel.getByText('1 active')).toBeVisible();
});
