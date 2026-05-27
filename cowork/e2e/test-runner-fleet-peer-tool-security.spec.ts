import path from 'node:path';
import { expect, test } from './fixtures';

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test('runs the Fleet peer tool security suite from the test runner window', async ({
  appPage,
}) => {
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

  const fleetId = 'code-buddy-fleet-peer-tool-security-suite';
  const fleetRow = appPage.getByTestId(`test-catalog-row-${fleetId}`);
  await expect(fleetRow).toBeVisible();
  await expect(fleetRow).toContainText('peer tool security suite');
  await expect(fleetRow).toContainText('allowlist');
  await expect(fleetRow).toContainText('PolicyEngine');
  await fleetRow.scrollIntoViewIfNeeded();
  await appPage.getByTestId(`test-catalog-run-${fleetId}`).click();

  await expect(appPage.getByTestId(`test-catalog-status-${fleetId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 150_000 }
  );
  await expect(appPage.getByTestId(`test-catalog-result-${fleetId}`)).toHaveText(
    '40 ok / 0 ko',
    { timeout: 150_000 }
  );

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/57-test-runner-fleet-peer-tool-security.png'
    ),
    fullPage: true,
  });
});
