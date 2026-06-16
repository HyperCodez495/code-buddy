import path from 'node:path';
import { expect, test } from './fixtures';

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test('runs the built Hermes CLI smoke from the test runner window', async ({ appPage }) => {
  test.setTimeout(420_000);
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

  const builtCliId = 'code-buddy-hermes-built-cli-real-smoke';
  const builtCliRow = appPage.getByTestId(`test-catalog-row-${builtCliId}`);
  await expect(builtCliRow).toBeVisible();
  await expect(builtCliRow).toContainText('compiled dist CLI');
  await builtCliRow.scrollIntoViewIfNeeded();
  await appPage.getByTestId(`test-catalog-run-${builtCliId}`).click();

  await expect(appPage.getByTestId(`test-catalog-status-${builtCliId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 360_000 }
  );
  await expect(appPage.getByTestId(`test-catalog-result-${builtCliId}`)).toHaveText(
    '1 ok / 0 ko',
    { timeout: 360_000 }
  );

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/109-test-runner-hermes-built-cli-real.png'
    ),
    fullPage: true,
  });
});
