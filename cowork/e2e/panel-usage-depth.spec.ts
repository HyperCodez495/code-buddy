import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function prepareWorkspace(appPage: Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }

  const repoRoot = path.resolve(process.cwd(), '..');
  const workdirResult = await appPage.evaluate(
    async (workspacePath) =>
      window.electronAPI?.invoke?.({
        type: 'workdir.set',
        payload: { path: workspacePath },
      }),
    repoRoot
  );
  expect(workdirResult).toMatchObject({ success: true });
  return repoRoot;
}

test('uses Fleet and Team controls without starting external services', async ({ appPage }) => {
  test.setTimeout(120_000);
  await prepareWorkspace(appPage);

  await appPage.getByTestId('fleet-panel-button').click();
  await expect(appPage.getByTestId('fleet-panel')).toBeVisible();
  await appPage.getByTestId('fleet-add-peer-button').click();
  await appPage.getByTestId('fleet-add-connect-button').click();
  await expect(appPage.getByTestId('fleet-add-error')).toContainText('URL required');
  await appPage.getByTestId('fleet-add-url-input').fill('ws://127.0.0.1:3999/ws');
  await appPage.getByTestId('fleet-add-api-key-input').fill('fleet-test-token');
  await appPage.getByTestId('fleet-add-label-input').fill('E2E local peer');
  await expect(appPage.getByTestId('fleet-add-url-input')).toHaveValue('ws://127.0.0.1:3999/ws');
  await expect(appPage.getByTestId('fleet-add-label-input')).toHaveValue('E2E local peer');
  await appPage.getByLabel('Close fleet panel').click();

  await appPage.getByTestId('team-panel-button').click();
  await expect(appPage.getByTestId('team-panel')).toBeVisible();
  await appPage.getByTestId('team-start-button').click();
  await appPage.getByTestId('team-goal-input').fill('Coordinate a safe E2E panel proof');
  await expect(appPage.getByTestId('team-goal-input')).toHaveValue(
    'Coordinate a safe E2E panel proof'
  );

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/34-fleet-team-used.png'
    ),
    fullPage: true,
  });

  await appPage.getByTestId('team-panel').getByRole('button', { name: 'Cancel' }).click();
  await appPage.getByLabel('Close team panel').click();
});

test('uses automation settings forms for commands, hooks, and schedules', async ({ appPage }) => {
  test.setTimeout(180_000);
  const repoRoot = await prepareWorkspace(appPage);

  await appPage.getByTestId('sidebar-settings-button').click();
  await expect(appPage.getByTestId('settings-panel')).toBeVisible();

  await appPage.getByTestId('settings-tab-customCommands').scrollIntoViewIfNeeded();
  await appPage.getByTestId('settings-tab-customCommands').click();
  await expect(appPage.getByTestId('settings-custom-commands')).toBeVisible();
  await appPage.getByTestId('custom-command-new').click();
  await appPage.getByTestId('custom-command-name-input').fill('qa-panel-proof');
  await appPage.getByTestId('custom-command-description-input').fill('E2E panel proof command');
  await appPage.getByTestId('custom-command-body-input').fill('Say QA_PANEL_PROOF for {{input}}');
  await appPage.getByTestId('custom-command-save').click();
  await expect(appPage.getByTestId('custom-command-row-qa-panel-proof')).toBeVisible();

  await appPage.getByTestId('settings-tab-hooks').scrollIntoViewIfNeeded();
  await appPage.getByTestId('settings-tab-hooks').click();
  await expect(appPage.getByTestId('settings-hooks')).toBeVisible();
  await appPage.getByTestId('hooks-new-button').click();
  await appPage.getByTestId('hooks-command-input').fill('echo HOOK_PANEL_OK');
  await appPage.getByTestId('hooks-test-button').click();
  await expect(appPage.getByTestId('hooks-test-result')).toContainText('HOOK_PANEL_OK', {
    timeout: 30_000,
  });

  await appPage.getByTestId('settings-tab-schedule').scrollIntoViewIfNeeded();
  await appPage.getByTestId('settings-tab-schedule').click();
  await expect(appPage.getByTestId('settings-schedule')).toBeVisible();
  await appPage.getByTestId('schedule-prompt-input').fill('QA panel scheduled proof');
  await appPage.getByTestId('schedule-cwd-input').fill(repoRoot);
  await appPage.getByTestId('schedule-create-button').click();
  await expect(appPage.getByTestId('settings-schedule')).toContainText(
    'QA panel scheduled proof',
    { timeout: 30_000 }
  );

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/35-automation-panels-used.png'
    ),
    fullPage: true,
  });
});
