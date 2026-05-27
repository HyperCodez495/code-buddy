import path from 'node:path';
import fs from 'node:fs';
import { expect, test } from './fixtures';

const REAL_COMPUTER_USE_ENABLED = process.env.CODEBUDDY_REAL_COMPUTER_USE === '1';

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test.skip(
  !REAL_COMPUTER_USE_ENABLED,
  'Set CODEBUDDY_REAL_COMPUTER_USE=1 to run the real Computer Use desktop suite from the GUI test runner.'
);

test('runs the real Computer Use desktop suite from the test runner window', async ({
  appPage,
}) => {
  test.setTimeout(480_000);
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

  const computerUseId = 'code-buddy-computer-use-real-desktop-suite';
  const computerUseRow = appPage.getByTestId(`test-catalog-row-${computerUseId}`);
  await expect(computerUseRow).toBeVisible();
  await expect(computerUseRow).toContainText('CODEBUDDY_REAL_COMPUTER_USE');
  await computerUseRow.scrollIntoViewIfNeeded();
  await appPage.getByTestId(`test-catalog-run-${computerUseId}`).click();

  await expect(appPage.getByTestId(`test-catalog-status-${computerUseId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 420_000 }
  );
  await expect(appPage.getByTestId(`test-catalog-result-${computerUseId}`)).toHaveText(
    '1 ok / 0 ko',
    { timeout: 420_000 }
  );

  const summaryPath = path.resolve(repoRoot, 'scratch/computer-use-real-suite-result.json');
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as {
    passed: boolean;
    results: Array<{ name: string; passed: boolean }>;
  };
  expect(summary.passed).toBe(true);
  expect(summary.results).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'Windows Forms controls', passed: true }),
      expect.objectContaining({ name: 'Dialog handling', passed: true }),
      expect.objectContaining({ name: 'Notepad profile save', passed: true }),
      expect.objectContaining({ name: 'Excel COM profile', passed: true }),
    ])
  );

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/108-test-runner-computer-use-real-suite.png'
    ),
    fullPage: true,
  });
});
