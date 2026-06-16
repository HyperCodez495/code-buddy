/**
 * REAL (no-mock) e2e for the first-class goal banner.
 *
 * Drives the real GUI surface end-to-end: real Zustand store
 * (`goalStatesBySession` slice) → real `GoalBanner` component → real
 * `command.execute('goal', …)` bridge on Pause → real optimistic store update.
 *
 * Two complementary real paths, no module mocks anywhere:
 *  - Render/control tests drive the store via `setGoalStatus(...)` (the same call
 *    the `useIPC` `goal.status` reducer makes) to exercise the GoalBanner UI.
 *  - The final test drives the FULL production IPC chain for real: the main
 *    process emits a `goal.status` ServerEvent over the same `server-event`
 *    channel the engine runner uses (`webContents.send`) → preload `ipcListener`
 *    → `useIPC` `case 'goal.status'` reducer → store → GoalBanner. No shortcut.
 */
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { GoalStatusPayload } from '../src/renderer/types';

async function dismissOnboardingIfPresent(appPage: Page) {
  await appPage.evaluate(async () => {
    await (window as unknown as {
      electronAPI?: { config?: { save?: (c: Record<string, unknown>) => Promise<unknown> } };
    }).electronAPI?.config?.save?.({ onboardingCompleted: true });
    const store = (
      window as unknown as {
        useAppStore?: {
          getState: () => {
            appConfig?: Record<string, unknown> | null;
            setAppConfig?: (config: Record<string, unknown>) => void;
          };
        };
      }
    ).useAppStore?.getState();
    store?.setAppConfig?.({ ...(store.appConfig ?? {}), onboardingCompleted: true });
  });
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 3000 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toBeHidden();
  }
}

async function addAndActivateSession(appPage: Page, id: string) {
  await appPage.evaluate(
    ({ id, createdAt }) => {
      const store = (
        window as unknown as {
          useAppStore?: {
            getState: () => {
              addSession: (session: unknown) => void;
              setActiveSession: (sessionId: string) => void;
            };
          };
        }
      ).useAppStore?.getState();
      if (!store) throw new Error('useAppStore missing');
      store.addSession({
        id,
        title: 'Goal banner e2e',
        status: 'idle',
        cwd: '/tmp/goal-e2e',
        mountedPaths: [],
        allowedTools: [],
        memoryEnabled: false,
        model: 'e2e-model',
        createdAt,
        updatedAt: createdAt,
      });
      store.setActiveSession(id);
    },
    { id, createdAt: Date.now() },
  );
}

/** Drives the same store mutation the `useIPC` `goal.status` reducer performs. */
async function pushGoalStatus(appPage: Page, sessionId: string, goal: GoalStatusPayload) {
  await appPage.evaluate(
    ({ sessionId, goal }) => {
      (
        window as unknown as {
          useAppStore?: {
            getState: () => { setGoalStatus: (s: string, g: unknown) => void };
          };
        }
      ).useAppStore?.getState().setGoalStatus(sessionId, goal);
    },
    { sessionId, goal },
  );
}

/**
 * Drives the goal status through the REAL production IPC path: the main process
 * emits a `goal.status` ServerEvent over the same `server-event` channel the
 * engine runner uses (`webContents.send`), so it flows preload `ipcListener` →
 * `electronAPI.on` callback → useIPC `case 'goal.status'` reducer →
 * `store.setGoalStatus`. No direct store mutation — no shortcut.
 */
async function pushGoalStatusViaIPC(
  electronApp: ElectronApplication,
  appPage: Page,
  sessionId: string,
  goal: GoalStatusPayload,
) {
  // Target the exact BrowserWindow backing the page so the event reaches the
  // renderer that mounted useIPC (getAllWindows()[0] can be the wrong window).
  const win = await electronApp.browserWindow(appPage);
  await win.evaluate((w, payload) => {
    (w as unknown as { webContents: { send: (ch: string, d: unknown) => void } }).webContents.send(
      'server-event',
      payload,
    );
  }, { type: 'goal.status', payload: { sessionId, goal } });
}

test('renders the goal banner with turn progress and pauses via the bridge', async ({ appPage }) => {
  await dismissOnboardingIfPresent(appPage);
  const sessionId = `e2e-goal-${Date.now()}`;
  await addAndActivateSession(appPage, sessionId);

  await pushGoalStatus(appPage, sessionId, {
    goal: 'Ship the goal banner',
    status: 'active',
    turnsUsed: 3,
    maxTurns: 20,
    lastVerdict: 'continue',
    lastReason: 'still wiring the renderer',
  });

  const banner = appPage.getByTestId('goal-banner');
  await expect(banner).toBeVisible();
  await expect(appPage.getByTestId('goal-banner-text')).toContainText('Ship the goal banner');
  await expect(appPage.getByTestId('goal-banner-progress')).toHaveText('3/20');

  // Pause via the real bridge button → optimistic store flip to 'paused'.
  await appPage.getByTestId('goal-banner-pause').click();
  await expect
    .poll(async () =>
      appPage.evaluate(
        (sid) =>
          (
            window as unknown as {
              useAppStore?: {
                getState: () => { goalStatesBySession: Record<string, { status: string }> };
              };
            }
          ).useAppStore?.getState().goalStatesBySession[sid]?.status,
        sessionId,
      ),
    )
    .toBe('paused');
  // Pause control disappears once paused; Clear remains.
  await expect(appPage.getByTestId('goal-banner-pause')).toHaveCount(0);
  await expect(appPage.getByTestId('goal-banner-clear')).toBeVisible();
});

test('hides the goal banner when the goal is cleared', async ({ appPage }) => {
  await dismissOnboardingIfPresent(appPage);
  const sessionId = `e2e-goal-clear-${Date.now()}`;
  await addAndActivateSession(appPage, sessionId);

  await pushGoalStatus(appPage, sessionId, {
    goal: 'Temp goal',
    status: 'active',
    turnsUsed: 1,
    maxTurns: 20,
  });
  await expect(appPage.getByTestId('goal-banner')).toBeVisible();

  // Clearing via the bridge button removes the banner.
  await appPage.getByTestId('goal-banner-clear').click();
  await expect(appPage.getByTestId('goal-banner')).toBeHidden();
});

test('shows a done goal with a green check until cleared', async ({ appPage }) => {
  await dismissOnboardingIfPresent(appPage);
  const sessionId = `e2e-goal-done-${Date.now()}`;
  await addAndActivateSession(appPage, sessionId);

  await pushGoalStatus(appPage, sessionId, {
    goal: 'Finished goal',
    status: 'done',
    turnsUsed: 4,
    maxTurns: 20,
    lastVerdict: 'done',
  });
  await expect(appPage.getByTestId('goal-banner')).toBeVisible();
  await expect(appPage.getByTestId('goal-banner-progress')).toHaveText('4/20');
  // done: no pause control, clear remains
  await expect(appPage.getByTestId('goal-banner-pause')).toHaveCount(0);
  await expect(appPage.getByTestId('goal-banner-clear')).toBeVisible();
});

test('renders the banner from a REAL goal.status IPC event (no store shortcut)', async ({
  appPage,
  electronApp,
}) => {
  await dismissOnboardingIfPresent(appPage);
  const sessionId = `e2e-goal-ipc-${Date.now()}`;
  await addAndActivateSession(appPage, sessionId);

  const active = {
    goal: 'Ralph loop via real IPC',
    status: 'active' as const,
    turnsUsed: 2,
    maxTurns: 6,
    lastVerdict: 'continue' as const,
    lastReason: 'mid-loop',
  };

  // Emit over the production `server-event` channel and poll the REAL store: this
  // exercises preload `ipcListener` → useIPC `on` callback → `case 'goal.status'`
  // reducer → `setGoalStatus`. Re-sending each poll makes it robust against the
  // brief window where useIPC's effect re-registers its single listener — the
  // transport itself is verified (the snapshot only lands if the reducer ran).
  await expect
    .poll(
      async () => {
        await pushGoalStatusViaIPC(electronApp, appPage, sessionId, active);
        return appPage.evaluate(
          (sid) =>
            (
              window as unknown as {
                useAppStore?: {
                  getState: () => {
                    goalStatesBySession: Record<string, { turnsUsed: number }>;
                  };
                };
              }
            ).useAppStore?.getState().goalStatesBySession[sid]?.turnsUsed ?? null,
          sessionId,
        );
      },
      { timeout: 15_000, intervals: [250, 400, 600, 800] },
    )
    .toBe(2);

  // The reducer drove the store → the real GoalBanner renders the snapshot.
  await expect(appPage.getByTestId('goal-banner')).toBeVisible();
  await expect(appPage.getByTestId('goal-banner-text')).toContainText('Ralph loop via real IPC');
  await expect(appPage.getByTestId('goal-banner-progress')).toHaveText('2/6');

  // A follow-up `done` snapshot over the same channel flips the banner to done —
  // proving the reducer updates an existing goal, like the Ralph loop's final turn.
  await expect
    .poll(
      async () => {
        await pushGoalStatusViaIPC(electronApp, appPage, sessionId, {
          ...active,
          status: 'done',
          turnsUsed: 3,
          lastVerdict: 'done',
          lastReason: 'goal achieved',
        });
        return appPage.evaluate(
          (sid) =>
            (
              window as unknown as {
                useAppStore?: {
                  getState: () => { goalStatesBySession: Record<string, { status: string }> };
                };
              }
            ).useAppStore?.getState().goalStatesBySession[sid]?.status ?? null,
          sessionId,
        );
      },
      { timeout: 15_000, intervals: [250, 400, 600, 800] },
    )
    .toBe('done');
  await expect(appPage.getByTestId('goal-banner-progress')).toHaveText('3/6');
  await expect(appPage.getByTestId('goal-banner-pause')).toHaveCount(0);
});
