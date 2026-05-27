import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function completeOnboardingForTest(appPage: Page) {
  await appPage.evaluate(async () => {
    await window.electronAPI?.config?.save?.({
      onboardingCompleted: true,
    } as Record<string, unknown>);
  });

  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible().catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toBeHidden();
  }
}

async function emitAssistantTurn(
  electronApp: ElectronApplication,
  sessionId: string,
  prompt: string,
  marker: string,
) {
  await electronApp.evaluate(
    ({ BrowserWindow }, input) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) {
        throw new Error('No Electron window available for chat IPC proof');
      }

      win.webContents.send('server-event', {
        type: 'stream.message',
        payload: {
          sessionId: input.sessionId,
          message: {
            id: `assistant-${input.marker}-${Date.now()}`,
            sessionId: input.sessionId,
            role: 'assistant',
            content: [{ type: 'text', text: `OK-CHAT-IPC ${input.marker}: ${input.prompt}` }],
            timestamp: Date.now(),
          },
        },
      });
      win.webContents.send('server-event', {
        type: 'session.status',
        payload: { sessionId: input.sessionId, status: 'idle' },
      });
    },
    { sessionId, prompt, marker },
  );
}

test('starts and continues a chat through the Electron IPC bridge', async ({
  electronApp,
  appPage,
}) => {
  await electronApp.evaluate(({ ipcMain }) => {
    const sessionId = 'e2e-chat-ipc-session';
    const session = {
      id: sessionId,
      title: 'E2E chat IPC',
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cwd: '',
      projectId: null,
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: false,
      model: 'gpt-5.5',
    };

    ipcMain.removeHandler('client-invoke');
    ipcMain.removeAllListeners('client-event');

    ipcMain.handle('client-invoke', async (event, clientEvent) => {
      if (clientEvent.type === 'session.start') {
        return session;
      }
      if (clientEvent.type === 'session.getMessages') {
        return [];
      }
      if (clientEvent.type === 'session.getTraceSteps') {
        return [];
      }
      return null;
    });

    ipcMain.on('client-event', (_event, clientEvent) => {
      if (clientEvent.type === 'session.continue') {
        return;
      }
    });
  });

  await completeOnboardingForTest(appPage);

  const initialPrompt = 'Initial GUI chat proof';
  await appPage.getByTestId('welcome-prompt-input').fill(initialPrompt);
  await appPage.getByTestId('welcome-prompt-input').press('Enter');

  await expect(appPage.getByText(initialPrompt, { exact: true })).toBeVisible({ timeout: 10_000 });
  await emitAssistantTurn(electronApp, 'e2e-chat-ipc-session', initialPrompt, 'start');
  await expect(appPage.getByText(`OK-CHAT-IPC start: ${initialPrompt}`)).toBeVisible({
    timeout: 10_000,
  });

  const followUpPrompt = 'Follow-up GUI chat proof';
  await appPage.getByTestId('chat-prompt-input').fill(followUpPrompt);
  await appPage.getByTestId('chat-prompt-input').press('Enter');

  await expect(appPage.getByText(followUpPrompt, { exact: true })).toBeVisible({ timeout: 10_000 });
  await emitAssistantTurn(electronApp, 'e2e-chat-ipc-session', followUpPrompt, 'continue');
  await expect(appPage.getByText(`OK-CHAT-IPC continue: ${followUpPrompt}`)).toBeVisible({
    timeout: 10_000,
  });
});
