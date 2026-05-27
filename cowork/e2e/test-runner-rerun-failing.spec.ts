import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures';

const workspaces: string[] = [];

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test.afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('re-runs the failing Vitest file after the fixture is fixed', async ({ appPage }) => {
  test.setTimeout(120_000);

  const workspacePath = path.join(
    process.cwd(),
    '.tmp-test-runner-rerun',
    String(Date.now()),
  );
  workspaces.push(path.join(process.cwd(), '.tmp-test-runner-rerun'));
  mkdirSync(path.join(workspacePath, 'tests'), { recursive: true });
  writeFileSync(
    path.join(workspacePath, 'vitest.config.ts'),
    "import { defineConfig } from 'vitest/config'; export default defineConfig({ test: { reporters: ['json'] } });\n",
  );
  writeFileSync(path.join(workspacePath, 'state.txt'), 'fail\n');
  writeFileSync(
    path.join(workspacePath, 'tests', 'flaky.test.ts'),
    [
      "import { readFileSync } from 'node:fs';",
      "import { expect, test } from 'vitest';",
      "test('RERUN_FAILING_MARKER', () => {",
      "  expect(readFileSync('state.txt', 'utf8').trim()).toBe('pass');",
      "});",
      '',
    ].join('\n'),
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

  await expect(appPage.getByText('Vitest')).toBeVisible({ timeout: 15_000 });
  await appPage.getByTestId('test-runner-run-all').click();

  await expect(appPage.getByTestId('test-runner-result-failed')).toHaveText('1', {
    timeout: 60_000,
  });
  await expect(appPage.getByTestId('test-runner-run-failing')).toBeEnabled();

  writeFileSync(path.join(workspacePath, 'state.txt'), 'pass\n');
  await appPage.getByTestId('test-runner-run-failing').click();

  await expect(appPage.getByTestId('test-runner-result-passed')).toHaveText('1', {
    timeout: 60_000,
  });
  await expect(appPage.getByTestId('test-runner-result-failed')).toHaveText('0');

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/47-test-runner-rerun-failing.png',
    ),
    fullPage: true,
  });
});
