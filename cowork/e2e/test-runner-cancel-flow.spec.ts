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

test('cancels a running catalog check and records it as cancelled', async ({ appPage, userDataDir }) => {
  test.setTimeout(120_000);

  const workspacePath = path.join(userDataDir, 'cancel-run-workspace');
  mkdirSync(workspacePath, { recursive: true });
  writeFileSync(
    path.join(workspacePath, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          'test:slow':
            'node -e "console.log(\'CANCEL_START_MARKER\'); setInterval(() => {}, 1000)"',
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

  const slowItemId = 'script-test-slow-test-slow';
  const slowRow = appPage.getByTestId(`test-catalog-row-${slowItemId}`);
  await expect(slowRow).toBeVisible({ timeout: 15_000 });
  await appPage.getByTestId(`test-catalog-run-${slowItemId}`).click();

  await expect(appPage.getByTestId('test-runner-cancel')).toBeVisible({ timeout: 10_000 });
  await appPage.getByTestId('test-runner-cancel').click();

  await expect(appPage.getByTestId(`test-catalog-status-${slowItemId}`)).toHaveAttribute(
    'aria-label',
    'skipped',
    { timeout: 30_000 },
  );
  await expect(slowRow).toContainText('0 ok / 0 ko', { timeout: 30_000 });
  await expect(appPage.getByTestId('test-runner-output')).not.toContainText('CANCEL_END_MARKER');
  await expect(appPage.getByText('Test run cancelled')).toBeVisible();

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/46-test-runner-cancel-flow.png',
    ),
    fullPage: true,
  });

  await appPage.getByTestId('test-runner-executions-tab').click();
  await expect(appPage.getByTestId('test-runner-executions-list')).toContainText(
    'Test runner: test:slow',
    { timeout: 20_000 },
  );
  await expect(appPage.getByTestId('test-runner-executions-list')).toContainText('cancelled');
});
