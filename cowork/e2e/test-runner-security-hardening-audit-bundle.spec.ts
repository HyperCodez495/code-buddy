import path from 'node:path';
import { expect, test } from './fixtures';

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test('runs the Security hardening audit bundle from the test runner window', async ({ appPage }) => {
  test.setTimeout(300_000);
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

  const bundleId = 'code-buddy-security-hardening-audit-bundle';
  const bundleRow = appPage.getByTestId(`test-catalog-row-${bundleId}`);
  await expect(bundleRow).toBeVisible();
  await expect(bundleRow).toContainText('hardening audit bundle');
  await expect(bundleRow).toContainText('policy engine');
  await expect(bundleRow).toContainText('secrets');
  await bundleRow.scrollIntoViewIfNeeded();
  await appPage.getByTestId(`test-catalog-run-${bundleId}`).click();

  await expect(appPage.getByTestId(`test-catalog-status-${bundleId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 260_000 }
  );
  await expect(appPage.getByTestId(`test-catalog-result-${bundleId}`)).toHaveText(
    '485 ok / 0 ko',
    { timeout: 260_000 }
  );

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/78-test-runner-security-hardening-audit-bundle.png'
    ),
    fullPage: true,
  });
});
