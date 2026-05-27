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

test('runs only safe catalog checks and leaves manual checks pending', async ({ appPage, userDataDir }) => {
  test.setTimeout(120_000);

  const workspacePath = path.join(userDataDir, 'safe-batch-workspace');
  mkdirSync(workspacePath, { recursive: true });
  writeFileSync(
    path.join(workspacePath, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          test: 'node -e "console.log(\'SAFE_BATCH_MARKER\')"',
          'test:e2e': 'node -e "console.error(\'UNSAFE_E2E_MARKER\'); process.exit(9)"',
        },
        devDependencies: {
          vitest: '1.0.0',
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

  await appPage.getByTestId('test-runner-button').click();
  await expect(appPage.getByRole('heading', { name: 'Tests & executions' })).toBeVisible();

  const safeItemId = 'script-test-test';
  const manualItemId = 'script-test-e2e-test-e2e';
  const safeRow = appPage.getByTestId(`test-catalog-row-${safeItemId}`);
  const manualRow = appPage.getByTestId(`test-catalog-row-${manualItemId}`);

  await expect(safeRow).toBeVisible({ timeout: 15_000 });
  await expect(manualRow).toBeVisible({ timeout: 15_000 });
  await expect(manualRow).toContainText('manual');

  await appPage.getByTestId('test-runner-run-safe').click();

  await expect(appPage.getByTestId(`test-catalog-status-${safeItemId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 60_000 },
  );
  await expect(appPage.getByTestId(`test-catalog-result-${safeItemId}`)).toHaveText(
    '1 ok / 0 ko',
    { timeout: 60_000 },
  );
  await expect(appPage.getByTestId(`test-catalog-status-${manualItemId}`)).toHaveAttribute(
    'aria-label',
    'pending',
  );
  await expect(appPage.getByTestId('test-runner-output')).toContainText('SAFE_BATCH_MARKER');
  await expect(appPage.getByTestId('test-runner-output')).not.toContainText('UNSAFE_E2E_MARKER');

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/45-test-runner-safe-batch.png',
    ),
    fullPage: true,
  });
});
