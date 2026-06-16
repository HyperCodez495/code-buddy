import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from './fixtures';

process.env.CODEBUDDY_TEST_RUNNER_SCRIPT_TIMEOUT_MS = '1500';

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

function hasNodeProcessWithMarker(marker: string): boolean {
  if (process.platform !== 'win32') return false;
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | Select-Object -First 1 -ExpandProperty ProcessId`,
    ],
    { encoding: 'utf8', timeout: 10_000 }
  );
  return result.status === 0 && result.stdout.trim().length > 0;
}

test('times out a hanging safe script from the test runner window', async ({
  appPage,
  userDataDir,
}) => {
  test.setTimeout(90_000);

  const workspacePath = path.join(userDataDir, 'script-timeout-workspace');
  const marker = `QA_UI_TIMEOUT_MARKER_${Date.now()}`;
  const scriptName = `timeout-${marker}.js`;
  mkdirSync(workspacePath, { recursive: true });
  writeFileSync(
    path.join(workspacePath, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          'test:hang': `node ${scriptName}`,
        },
        devDependencies: {
          vitest: '1.0.0',
        },
      },
      null,
      2
    )
  );
  writeFileSync(
    path.join(workspacePath, scriptName),
    `console.log('${marker}');\nsetInterval(() => {}, 1000);\n`
  );

  await dismissOnboardingIfPresent(appPage);

  const workdirResult = await appPage.evaluate(
    async (targetPath) =>
      window.electronAPI?.invoke?.({
        type: 'workdir.set',
        payload: { path: targetPath },
      }),
    workspacePath
  );
  expect(workdirResult).toMatchObject({ success: true });

  await appPage.getByText('Outils').click();
  await appPage.getByText('Test Runner').click();
  await expect(appPage.getByRole('heading', { name: 'Tests & executions' })).toBeVisible();

  const itemId = 'script-test-hang-test-hang';
  const row = appPage.getByTestId(`test-catalog-row-${itemId}`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).not.toContainText('manual');
  await appPage.getByTestId(`test-catalog-run-${itemId}`).click();

  await expect(appPage.getByTestId(`test-catalog-status-${itemId}`)).toHaveAttribute(
    'aria-label',
    'failed',
    { timeout: 30_000 }
  );
  await expect(appPage.getByTestId(`test-catalog-result-${itemId}`)).toHaveText(
    '0 ok / 1 ko',
    { timeout: 30_000 }
  );
  await expect(appPage.getByTestId('test-runner-output')).toContainText(
    'Timed out after 1500ms'
  );
  expect(hasNodeProcessWithMarker(marker)).toBe(false);

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/50-test-runner-script-timeout.png'
    ),
    fullPage: true,
  });

  await appPage.getByTestId('test-runner-executions-tab').click();
  await expect(appPage.getByTestId('test-runner-executions-list')).toContainText(
    'Test runner: test:hang',
    { timeout: 20_000 }
  );
  await expect(appPage.getByTestId('test-runner-executions-list')).toContainText('failed');
  await expect(appPage.getByTestId('test-runner-executions-list')).toContainText('test-runner');

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/51-test-runner-timeout-execution-monitor.png'
    ),
    fullPage: true,
  });
});
