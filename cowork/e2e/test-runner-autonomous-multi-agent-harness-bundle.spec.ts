import path from 'node:path';
import { expect, test } from './fixtures';

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test('runs the Autonomous multi-agent harness bundle from the test runner window', async ({ appPage }) => {
  test.setTimeout(360_000);
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

  const bundleId = 'code-buddy-autonomous-multi-agent-harness-bundle';
  const bundleRow = appPage.getByTestId(`test-catalog-row-${bundleId}`);
  await expect(bundleRow).toBeVisible();
  await expect(bundleRow).toContainText('multi-agent harness bundle');
  await expect(bundleRow).toContainText('checkpoints');
  await expect(bundleRow).toContainText('workflow orchestrator');
  await bundleRow.scrollIntoViewIfNeeded();
  await appPage.getByTestId(`test-catalog-run-${bundleId}`).click();

  await expect(appPage.getByTestId(`test-catalog-status-${bundleId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 320_000 }
  );
  await expect(appPage.getByTestId(`test-catalog-result-${bundleId}`)).toHaveText(
    '451 ok / 0 ko',
    { timeout: 320_000 }
  );

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/75-test-runner-autonomous-multi-agent-harness-bundle.png'
    ),
    fullPage: true,
  });
});
