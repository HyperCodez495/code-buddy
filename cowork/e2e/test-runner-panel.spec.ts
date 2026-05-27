import path from 'node:path';
import { expect, test } from './fixtures';

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test('opens the QA window with catalog checks and execution tracking', async ({ appPage }) => {
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

  await appPage.getByTestId('test-runner-button').click();
  await expect(appPage.getByRole('heading', { name: 'Tests & executions' })).toBeVisible();
  await expect(appPage.getByText('typecheck', { exact: true })).toBeVisible();
  await expect(appPage.getByText('Cowork / typecheck', { exact: true })).toBeVisible();
  await expect(appPage.getByText('Cowork / real GPT-5.5 chat', { exact: true })).toBeVisible();
  await expect(appPage.getByText('Server / real GPT-5.5 chat API', { exact: true })).toBeVisible();
  await expect(appPage.getByText('CLI / headless provider failure exit', { exact: true })).toBeVisible();
  await expect(appPage.getByText('Fleet/MCP local smoke suite', { exact: true })).toBeVisible();
  await expect(appPage.getByText('Docker / real sandbox smoke', { exact: true })).toBeVisible();
  await expect(appPage.getByText('Computer Use / real desktop suite', { exact: true })).toBeVisible();
  await expect(appPage.getByTestId('test-catalog-row-code-buddy-server-real-gpt55-chat')).toContainText(
    'CODEBUDDY_REAL_GPT55_SERVER'
  );
  await expect(appPage.getByTestId('test-catalog-row-code-buddy-docker-sandbox-real-smoke')).toContainText(
    'CODEBUDDY_REAL_DOCKER_SANDBOX'
  );
  await expect(appPage.getByTestId('test-catalog-row-code-buddy-computer-use-real-desktop-suite')).toContainText(
    'CODEBUDDY_REAL_COMPUTER_USE'
  );

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/30-test-runner-window.png'
    ),
    fullPage: true,
  });

  const providerRegressionId = 'code-buddy-provider-command-regression';
  const providerRegressionRow = appPage.getByTestId(`test-catalog-row-${providerRegressionId}`);
  await expect(providerRegressionRow).toBeVisible();
  await providerRegressionRow.scrollIntoViewIfNeeded();
  await appPage.getByTestId(`test-catalog-run-${providerRegressionId}`).click();
  await expect(appPage.getByTestId(`test-catalog-status-${providerRegressionId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 120_000 }
  );
  await expect(appPage.getByTestId(`test-catalog-result-${providerRegressionId}`)).toHaveText(
    /\d+ ok \/ 0 ko/,
    { timeout: 120_000 }
  );
  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/32-test-runner-used-check.png'
    ),
    fullPage: true,
  });

  const headlessExitId = 'code-buddy-headless-provider-failure-exit';
  const headlessExitRow = appPage.getByTestId(`test-catalog-row-${headlessExitId}`);
  await expect(headlessExitRow).toBeVisible();
  await headlessExitRow.scrollIntoViewIfNeeded();
  await appPage.getByTestId(`test-catalog-run-${headlessExitId}`).click();
  await expect(appPage.getByTestId(`test-catalog-status-${headlessExitId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 120_000 }
  );
  await expect(appPage.getByTestId(`test-catalog-result-${headlessExitId}`)).toHaveText(
    /\d+ ok \/ 0 ko/,
    { timeout: 120_000 }
  );

  const fleetMcpId = 'code-buddy-fleet-mcp-local-smoke-suite';
  const fleetMcpRow = appPage.getByTestId(`test-catalog-row-${fleetMcpId}`);
  await expect(fleetMcpRow).toBeVisible();
  await fleetMcpRow.scrollIntoViewIfNeeded();
  await appPage.getByTestId(`test-catalog-run-${fleetMcpId}`).click();
  await expect(appPage.getByTestId(`test-catalog-status-${fleetMcpId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 120_000 }
  );
  await expect(appPage.getByTestId(`test-catalog-result-${fleetMcpId}`)).toHaveText(
    /\d+ ok \/ 0 ko/,
    { timeout: 120_000 }
  );

  await appPage.getByTestId('test-runner-executions-tab').click();
  await expect(appPage.getByTestId('test-runner-executions-list')).toBeVisible();
  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/31-test-runner-executions.png'
    ),
    fullPage: true,
  });

  await appPage.getByTestId('test-runner-coverage-tab').click();
  await expect(appPage.getByTestId('test-runner-coverage-list')).toBeVisible();
  await expect(appPage.getByTestId('test-coverage-row-chat-ui')).toContainText(
    'Chat UI'
  );
  await expect(appPage.getByTestId('test-coverage-row-test-runner')).toContainText(
    'lancement de check depuis le panneau'
  );
  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/33-test-runner-coverage.png'
    ),
    fullPage: true,
  });
});
