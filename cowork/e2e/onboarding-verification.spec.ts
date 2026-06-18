/**
 * Onboarding wizard — inline provider verification (B1/B2).
 *
 * Proves on a real Electron boot that:
 *  1. The first-run wizard renders the new connection/verification panel.
 *  2. Opening API settings no longer unmounts the wizard (App.tsx change) —
 *     the user returns to it after configuring.
 *  3. The exact reachability IPC the "Test connection" button invokes
 *     (`config.test`) really reaches a local Ollama and returns ok.
 */
import { test, expect } from './fixtures';

test('wizard renders the verification panel and its probe reaches Ollama', async ({ appPage }) => {
  const wizard = appPage.getByTestId('onboarding-wizard');
  await expect(wizard).toBeVisible({ timeout: 30_000 });

  // Welcome → Quick start → provider step.
  await appPage.getByTestId('onboarding-path-quickstart').click();

  // New inline verification UI is present (was inert info-cards before).
  await expect(appPage.getByTestId('onboarding-connection-panel')).toBeVisible();
  await expect(appPage.getByTestId('onboarding-test-connection')).toBeVisible();

  // Opening API settings keeps the wizard mounted underneath.
  await appPage.getByTestId('onboarding-open-api').click();
  await expect(wizard).toHaveCount(1);

  // The verification IPC the Test button calls really reaches local Ollama.
  const result = await appPage.evaluate(async () => {
    type Cfg = { config: { test: (i: unknown) => Promise<{ ok: boolean; errorType?: string }> } };
    const api = (window as unknown as { electronAPI?: Cfg }).electronAPI;
    if (!api?.config?.test) return { ok: false, errorType: 'no_ipc' };
    return api.config.test({
      provider: 'ollama',
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5:7b-instruct',
      useLiveRequest: true,
    });
  });
  expect(result.ok, `config.test errorType=${result.errorType ?? 'none'}`).toBe(true);
});
