import { expect, test } from './fixtures';

test('the new shell opens both media-library entries without a lazy-module crash', async ({ appPage }) => {
  const relevantErrors: string[] = [];
  appPage.on('pageerror', (error) => {
    if (/MediaLibrary(View|Panel)|Cannot read properties of undefined/.test(error.message)) {
      relevantErrors.push(error.message);
    }
  });

  await appPage.evaluate(() => {
    localStorage.setItem('cowork.tourSeen', '1');
    const store = (
      window as unknown as {
        useAppStore?: {
          getState: () => {
            setNewShellEnabled: (enabled: boolean) => void;
            setPrimaryView: (view: 'chat' | 'library') => void;
          };
        };
      }
    ).useAppStore?.getState();

    if (!store) throw new Error('useAppStore missing');
    store.setPrimaryView('chat');
    store.setNewShellEnabled(true);
  });

  await expect(appPage.getByTestId('new-shell')).toBeVisible();
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toBeHidden();
  }
  const tour = appPage.getByTestId('onboarding-tour');
  if (await tour.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await tour.getByRole('button', { name: 'Passer', exact: true }).click();
    await expect(tour).toBeHidden();
  }

  await appPage.getByTitle('Créations', { exact: true }).click();
  await expect(appPage.getByTestId('creations-view')).toBeVisible();
  await appPage.getByRole('button', { name: 'Médias', exact: true }).click();
  await expect(appPage.getByTestId('media-library-panel')).toBeVisible();

  await appPage.getByTitle('Bibliothèque', { exact: true }).click();

  await expect(appPage.getByTestId('media-library-view')).toBeVisible();
  await expect(appPage.getByRole('heading', { name: 'Bibliothèque', exact: true })).toBeVisible();
  expect(relevantErrors).toEqual([]);
});
