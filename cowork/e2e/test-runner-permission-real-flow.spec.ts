import path from 'node:path';
import { expect, test } from './fixtures';

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test('runs the real permission flow from the test runner window', async ({ appPage }) => {
  test.setTimeout(180_000);
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

  const permissionId = 'code-buddy-cowork-permission-real-flow';
  const permissionRow = appPage.getByTestId(`test-catalog-row-${permissionId}`);
  await expect(permissionRow).toBeVisible();
  await expect(permissionRow).toContainText('permission real flow');
  await expect(permissionRow).toContainText('Playwright permission dialog IPC');
  await permissionRow.scrollIntoViewIfNeeded();
  await appPage.getByTestId(`test-catalog-run-${permissionId}`).click();

  await expect(appPage.getByTestId(`test-catalog-status-${permissionId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 150_000 }
  );
  await expect(appPage.getByTestId(`test-catalog-result-${permissionId}`)).toHaveText(
    '1 ok / 0 ko',
    { timeout: 150_000 }
  );

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/55-test-runner-permission-real-flow.png'
    ),
    fullPage: true,
  });
});
