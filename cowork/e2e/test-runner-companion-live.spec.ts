import path from 'node:path';
import { expect, test } from './fixtures';

const LIVE_COMPANION_ENABLED = process.env.COWORK_LIVE_COMPANION === '1';

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test.skip(
  !LIVE_COMPANION_ENABLED,
  'Set COWORK_LIVE_COMPANION=1 to run the live companion smoke from the GUI test runner.'
);

test('runs the live companion core IPC smoke from the test runner window', async ({ appPage }) => {
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

  const companionId = 'code-buddy-cowork-live-companion';
  const companionRow = appPage.getByTestId(`test-catalog-row-${companionId}`);
  await expect(companionRow).toBeVisible();
  await expect(companionRow).toContainText('COWORK_LIVE_COMPANION');
  await companionRow.scrollIntoViewIfNeeded();
  await appPage.getByTestId(`test-catalog-run-${companionId}`).click();

  await expect(appPage.getByTestId(`test-catalog-status-${companionId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 300_000 }
  );
  await expect(appPage.getByTestId(`test-catalog-result-${companionId}`)).toHaveText(
    '1 ok / 0 ko',
    { timeout: 300_000 }
  );

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/53-test-runner-companion-live.png'
    ),
    fullPage: true,
  });
});
