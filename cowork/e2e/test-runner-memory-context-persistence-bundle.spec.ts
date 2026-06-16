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

test('runs the Memory context persistence bundle from the test runner window', async ({ appPage }) => {
  test.setTimeout(240_000);
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

  const bundleId = 'code-buddy-memory-context-persistence-bundle';
  const bundleRow = appPage.getByTestId(`test-catalog-row-${bundleId}`);
  await expect(bundleRow).toBeVisible();
  await expect(bundleRow).toContainText('context persistence bundle');
  await expect(bundleRow).toContainText('ContextManager');
  await expect(bundleRow).toContainText('checkpoints');
  await bundleRow.scrollIntoViewIfNeeded();
  await appPage.getByTestId(`test-catalog-run-${bundleId}`).click();

  await expect(appPage.getByTestId(`test-catalog-status-${bundleId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 200_000 }
  );
  await expect
    .poll(async () => parseResultCount(await appPage.getByTestId(`test-catalog-result-${bundleId}`).innerText()), {
      timeout: 200_000,
    })
    .toMatchObject({ failed: 0, passed: expect.any(Number) });

  const result = parseResultCount(await appPage.getByTestId(`test-catalog-result-${bundleId}`).innerText());
  expect(result.passed).toBeGreaterThanOrEqual(561);

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/71-test-runner-memory-context-persistence-bundle.png'
    ),
    fullPage: true,
  });
});
