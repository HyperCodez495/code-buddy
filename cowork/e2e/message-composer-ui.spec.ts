import { expect, test } from './fixtures';

test.describe('MessageComposer E2E', () => {
  test('should render the extracted message composer properly', async ({
    appPage,
  }) => {
    // Dismiss onboarding if any
    await appPage.evaluate(async () => {
      await window.electronAPI?.config?.save?.({
        onboardingCompleted: true,
      } as Record<string, unknown>);
    });
    const onboarding = appPage.getByTestId('onboarding-wizard');
    if (await onboarding.isVisible().catch(() => false)) {
      await appPage.getByTestId('onboarding-skip').click();
    }

    // Look for the text area inside the form
    const textarea = appPage.locator('textarea').first();
    await expect(textarea).toBeVisible();

    // Type a message
    await textarea.fill('Hello this is from the new MessageComposer');
    await expect(textarea).toHaveValue('Hello this is from the new MessageComposer');

    // Make sure we have the submit button
    const submitBtn = appPage.locator('button[type="submit"]');
    await expect(submitBtn).toBeVisible();

    // We can't easily mock the IPC here without the helper, 
    // but we can at least assert the UI is connected.
    // Ensure Shift+Enter does not clear the input (adds a newline)
    await textarea.press('Shift+Enter');
    await expect(textarea).toHaveValue('Hello this is from the new MessageComposer\n');
  });
});
