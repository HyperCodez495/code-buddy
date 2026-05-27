import path from 'node:path';
import { expect, test } from './fixtures';

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test('runs the feature completion depth suite from the test runner window', async ({
  appPage,
}) => {
  test.setTimeout(400_000);
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

  await appPage.getByTestId('test-runner-button').click();
  await expect(appPage.getByRole('heading', { name: 'Tests & executions' })).toBeVisible();

  const completionId = 'code-buddy-cowork-feature-completion-depth';
  const completionRow = appPage.getByTestId(`test-catalog-row-${completionId}`);
  await expect(completionRow).toBeVisible();
  await expect(completionRow).toContainText('feature completion depth');
  await expect(completionRow).toContainText('orchestrateur');
  await expect(completionRow).toContainText('MCP');
  await completionRow.scrollIntoViewIfNeeded();
  await appPage.getByTestId(`test-catalog-run-${completionId}`).click();

  await expect(appPage.getByTestId(`test-catalog-status-${completionId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 360_000 }
  );
  await expect(appPage.getByTestId(`test-catalog-result-${completionId}`)).toHaveText(
    '4 ok / 0 ko',
    { timeout: 360_000 }
  );

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/62-test-runner-feature-completion-depth.png'
    ),
    fullPage: true,
  });
});
