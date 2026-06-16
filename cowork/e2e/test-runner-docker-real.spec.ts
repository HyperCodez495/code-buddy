import path from 'node:path';
import { expect, test } from './fixtures';

const REAL_DOCKER_SANDBOX_ENABLED = process.env.COWORK_REAL_DOCKER_SANDBOX === '1';

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test.skip(
  !REAL_DOCKER_SANDBOX_ENABLED,
  'Set COWORK_REAL_DOCKER_SANDBOX=1 to run the real Docker sandbox smoke from the GUI.'
);

test('runs the real Docker sandbox smoke from the test runner window', async ({ appPage }) => {
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

  await appPage.getByText('Outils').click();
  await appPage.getByText('Test Runner').click();
  await expect(appPage.getByRole('heading', { name: 'Tests & executions' })).toBeVisible();

  const dockerSmokeId = 'code-buddy-docker-sandbox-real-smoke';
  const dockerSmokeRow = appPage.getByTestId(`test-catalog-row-${dockerSmokeId}`);
  await expect(dockerSmokeRow).toBeVisible();
  await expect(dockerSmokeRow).toContainText('CODEBUDDY_REAL_DOCKER_SANDBOX');
  await dockerSmokeRow.scrollIntoViewIfNeeded();
  await appPage.getByTestId(`test-catalog-run-${dockerSmokeId}`).click();

  await expect(appPage.getByTestId(`test-catalog-status-${dockerSmokeId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 120_000 }
  );
  await expect(appPage.getByTestId(`test-catalog-result-${dockerSmokeId}`)).toHaveText(
    '1 ok / 0 ko',
    { timeout: 120_000 }
  );

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/44-test-runner-docker-real.png'
    ),
    fullPage: true,
  });
});
