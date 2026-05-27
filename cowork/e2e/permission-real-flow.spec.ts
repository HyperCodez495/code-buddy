import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  createAndActivateProject,
  expectSavedRule,
  injectPermissionRequest,
} from './permission-helpers';

async function dismissOnboardingIfPresent(appPage: Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test('uses permission dialog IPC and persists a scoped file rule', async ({
  electronApp,
  appPage,
  userDataDir,
}) => {
  test.setTimeout(90_000);
  await dismissOnboardingIfPresent(appPage);
  const { projectId, settingsPath } = await createAndActivateProject(
    appPage,
    userDataDir,
    'permission-real-flow-workspace',
    'Permission Real Flow'
  );

  await electronApp.evaluate(({ ipcMain }) => {
    const g = globalThis as typeof globalThis & {
      __permissionResponses?: unknown[];
      __permissionClientEventListener?: (_event: unknown, data: unknown) => void;
    };
    if (g.__permissionClientEventListener) {
      ipcMain.removeListener('client-event', g.__permissionClientEventListener);
    }
    g.__permissionResponses = [];
    g.__permissionClientEventListener = (_event: unknown, data: unknown) => {
      if (
        typeof data === 'object' &&
        data !== null &&
        'type' in data &&
        (data as { type?: string }).type === 'permission.response'
      ) {
        g.__permissionResponses?.push((data as { payload?: unknown }).payload);
      }
    };
    ipcMain.on('client-event', g.__permissionClientEventListener);
  });

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-ipc-allow',
    toolName: 'Bash',
    input: { command: 'git status --short' },
    projectId,
    action: 'bash.exec',
    details: { command: 'git status --short' },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await expect(appPage.getByTestId('permission-scoped-rule-draft-input')).toHaveValue(
    'Bash(git *)'
  );
  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/41-permission-dialog-real-flow.png'
    ),
    fullPage: true,
  });
  await appPage.getByTestId('permission-allow-button').click();
  await expect(appPage.getByTestId('permission-dialog')).toBeHidden();
  await expect
    .poll(() =>
      electronApp.evaluate(() => {
        const g = globalThis as typeof globalThis & { __permissionResponses?: unknown[] };
        return g.__permissionResponses;
      })
    )
    .toEqual([{ toolUseId: 'e2e-permission-ipc-allow', result: 'allow' }]);

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-folder-allow',
    toolName: 'Write',
    input: { file_path: 'docs\\guide.md' },
    projectId,
    action: 'write.file',
    details: { file_path: 'docs\\guide.md' },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await appPage.getByTestId('permission-use-folder-rule-button').click();
  await expect(appPage.getByTestId('permission-scoped-rule-draft-input')).toHaveValue(
    'Write(docs/*)'
  );
  await appPage.getByTestId('permission-always-allow-target-button').click();
  await expect(appPage.getByTestId('permission-dialog')).toBeHidden();
  await expectSavedRule(settingsPath, 'Write(docs/*)');

  await electronApp.evaluate(({ ipcMain }) => {
    const g = globalThis as typeof globalThis & {
      __permissionClientEventListener?: (_event: unknown, data: unknown) => void;
    };
    if (g.__permissionClientEventListener) {
      ipcMain.removeListener('client-event', g.__permissionClientEventListener);
      g.__permissionClientEventListener = undefined;
    }
  });
});
