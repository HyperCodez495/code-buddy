import path from 'node:path';
import { expect, test } from './fixtures';

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test('runs the deterministic companion cockpit from the test runner window', async ({
  appPage,
}) => {
  test.setTimeout(320_000);
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

  const companionId = 'code-buddy-cowork-companion-deterministic-panel';
  const companionRow = appPage.getByTestId(`test-catalog-row-${companionId}`);
  await expect(companionRow).toBeVisible();
  await expect(companionRow).toContainText('companion deterministic panel');
  await expect(companionRow).toContainText('cockpit compagnon');
  await expect(companionRow).toContainText('improvement loop');
  await companionRow.scrollIntoViewIfNeeded();
  await appPage.getByTestId(`test-catalog-run-${companionId}`).click();

  await expect(appPage.getByTestId(`test-catalog-status-${companionId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 280_000 }
  );
  await expect(appPage.getByTestId(`test-catalog-result-${companionId}`)).toHaveText(
    '1 ok / 0 ko',
    { timeout: 280_000 }
  );

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/60-test-runner-companion-deterministic-panel.png'
    ),
    fullPage: true,
  });
});
