import path from 'node:path';
import { expect, test } from './fixtures';

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test('runs the panel usage depth suite from the test runner window', async ({ appPage }) => {
  test.setTimeout(280_000);
  const repoRoot = path.resolve(process.cwd(), '..');
  await dismissOnboardingIfPresent(appPage);

  const workdirResult = await appPage.evaluate(
    async (workspacePath) =>
      window.electronAPI?.invoke?.({
        type: 'workdir.set',
        payload: { path: workspacePath },
      }),
    repoRoot
  );
  expect(workdirResult).toMatchObject({ success: true });

  await appPage.getByText('Outils').click();
  await appPage.getByText('Test Runner').click();
  await expect(appPage.getByRole('heading', { name: 'Tests & executions' })).toBeVisible();

  const panelUsageId = 'code-buddy-cowork-panel-usage-depth';
  const panelUsageRow = appPage.getByTestId(`test-catalog-row-${panelUsageId}`);
  await expect(panelUsageRow).toBeVisible();
  await expect(panelUsageRow).toContainText('panel usage depth');
  await expect(panelUsageRow).toContainText('Fleet');
  await expect(panelUsageRow).toContainText('planifications');
  await panelUsageRow.scrollIntoViewIfNeeded();
  await appPage.getByTestId(`test-catalog-run-${panelUsageId}`).click();

  await expect(appPage.getByTestId(`test-catalog-status-${panelUsageId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 240_000 }
  );
  await expect(appPage.getByTestId(`test-catalog-result-${panelUsageId}`)).toHaveText(
    '2 ok / 0 ko',
    { timeout: 240_000 }
  );

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/61-test-runner-panel-usage-depth.png'
    ),
    fullPage: true,
  });
});
