import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures';

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test('tracks a real failing catalog run with stderr evidence', async ({ appPage, userDataDir }) => {
  test.setTimeout(120_000);

  const workspacePath = path.join(userDataDir, 'failing-run-workspace');
  mkdirSync(workspacePath, { recursive: true });
  writeFileSync(
    path.join(workspacePath, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          test: 'node -e "console.log(\'1 passed\')"',
          'test:fail': 'node -e "console.error(\'QA_FAIL_MARKER\'); process.exit(7)"',
        },
      },
      null,
      2,
    ),
  );

  await dismissOnboardingIfPresent(appPage);

  const workdirResult = await appPage.evaluate(
    async (targetPath) =>
      window.electronAPI?.invoke?.({
        type: 'workdir.set',
        payload: { path: targetPath },
      }),
    workspacePath,
  );
  expect(workdirResult).toMatchObject({ success: true });

  await appPage.getByText('Outils').click();
  await appPage.getByText('Test Runner').click();
  await expect(appPage.getByRole('heading', { name: 'Tests & executions' })).toBeVisible();

  const failingItemId = 'script-test-fail-test-fail';
  const failingRow = appPage.getByTestId(`test-catalog-row-${failingItemId}`);
  await expect(failingRow).toBeVisible({ timeout: 15_000 });
  await expect(failingRow).toContainText('test:fail');
  await appPage.getByTestId(`test-catalog-run-${failingItemId}`).click();

  await expect(appPage.getByTestId(`test-catalog-status-${failingItemId}`)).toHaveAttribute(
    'aria-label',
    'failed',
    { timeout: 60_000 },
  );
  await expect(appPage.getByTestId(`test-catalog-result-${failingItemId}`)).toHaveText(
    '0 ok / 1 ko',
    { timeout: 60_000 },
  );
  await expect(appPage.getByTestId('test-runner-output')).toContainText('QA_FAIL_MARKER');
  await expect(failingRow).toContainText('QA_FAIL_MARKER');

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/42-test-runner-failure-flow.png',
    ),
    fullPage: true,
  });

  await appPage.getByTestId('test-runner-executions-tab').click();
  await expect(appPage.getByTestId('test-runner-executions-list')).toContainText(
    'Test runner: test:fail',
    { timeout: 20_000 },
  );
  await expect(appPage.getByTestId('test-runner-executions-list')).toContainText('failed');
  await expect(appPage.getByTestId('test-runner-executions-list')).toContainText('test-runner');
  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/43-test-runner-execution-monitor.png',
    ),
    fullPage: true,
  });
});
