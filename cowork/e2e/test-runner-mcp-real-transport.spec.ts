import path from 'node:path';
import { expect, test } from './fixtures';

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test('runs the MCP real transport suite from the test runner window', async ({
  appPage,
}) => {
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

  const mcpId = 'code-buddy-mcp-real-transport-suite';
  const mcpRow = appPage.getByTestId(`test-catalog-row-${mcpId}`);
  await expect(mcpRow).toBeVisible();
  await expect(mcpRow).toContainText('real transport suite');
  await expect(mcpRow).toContainText('stdio');
  await expect(mcpRow).toContainText('HTTP JSON-RPC');
  await expect(mcpRow).toContainText('fail-closed');
  await mcpRow.scrollIntoViewIfNeeded();
  await appPage.getByTestId(`test-catalog-run-${mcpId}`).click();

  await expect(appPage.getByTestId(`test-catalog-status-${mcpId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 150_000 }
  );
  await expect(appPage.getByTestId(`test-catalog-result-${mcpId}`)).toHaveText(
    '3 ok / 0 ko',
    { timeout: 150_000 }
  );

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/58-test-runner-mcp-real-transport.png'
    ),
    fullPage: true,
  });
});
