import path from 'node:path';
import { expect, test } from './fixtures';

function parseResultCount(text: string): { failed: number; passed: number } {
  const match = text.match(/^(\d+) ok \/ (\d+) ko$/);
  expect(match, `Unexpected test result text: ${text}`).not.toBeNull();
  return {
    passed: Number(match![1]),
    failed: Number(match![2]),
  };
}

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test('runs the Fleet routing orchestration bundle from the test runner window', async ({ appPage }) => {
  test.setTimeout(260_000);
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

  const bundleId = 'code-buddy-fleet-routing-orchestration-bundle';
  const bundleRow = appPage.getByTestId(`test-catalog-row-${bundleId}`);
  await expect(bundleRow).toBeVisible();
  await expect(bundleRow).toContainText('routing orchestration bundle');
  await expect(bundleRow).toContainText('TaskRouter');
  await expect(bundleRow).toContainText('privacy lint');
  await bundleRow.scrollIntoViewIfNeeded();
  await appPage.getByTestId(`test-catalog-run-${bundleId}`).click();

  await expect(appPage.getByTestId(`test-catalog-status-${bundleId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 220_000 }
  );
  await expect
    .poll(async () => parseResultCount(await appPage.getByTestId(`test-catalog-result-${bundleId}`).innerText()), {
      timeout: 220_000,
    })
    .toMatchObject({ failed: 0, passed: expect.any(Number) });

  const result = parseResultCount(await appPage.getByTestId(`test-catalog-result-${bundleId}`).innerText());
  expect(result.passed).toBeGreaterThanOrEqual(357);

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/85-test-runner-fleet-routing-orchestration-bundle.png'
    ),
    fullPage: true,
  });
});
