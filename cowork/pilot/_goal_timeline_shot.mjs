/**
 * Capture the GoalBanner phase timeline. Builds it through the REAL store
 * reducer (`setGoalStatus` — the exact call the useIPC `goal.status` event makes)
 * for a representative Ralph-loop sequence (set → turn 1 continue → turn 2
 * continue → done), then screenshots the banner + timeline.
 */
import { CoworkPilot } from './pilot-core.mjs';

const OUT = process.argv[2] || '/tmp/goal-timeline.png';
const pilot = new CoworkPilot({ log: () => {} });

try {
  await pilot.launch();

  // Dismiss onboarding if it's up (overlay would hide the chat view).
  await pilot.page.evaluate(async () => {
    const api = window.electronAPI;
    await api?.config?.save?.({ onboardingCompleted: true });
    const store = window.useAppStore?.getState?.();
    store?.setAppConfig?.({ ...(store.appConfig ?? {}), onboardingCompleted: true });
  });
  try {
    const skip = pilot.page.getByTestId('onboarding-skip');
    if (await skip.isVisible({ timeout: 2500 }).catch(() => false)) await skip.click();
  } catch { /* no onboarding */ }

  // Create + activate a session, then drive the goal-loop snapshots.
  await pilot.page.evaluate(async () => {
    const store = window.useAppStore?.getState?.();
    if (!store) throw new Error('window.useAppStore missing');
    const id = 'goal-timeline-demo';
    store.addSession({
      id, title: 'Goal timeline', status: 'idle', cwd: '/tmp',
      mountedPaths: [], allowedTools: [], memoryEnabled: false,
      model: 'gpt-5.5', createdAt: 1, updatedAt: 1,
    });
    store.setActiveSession(id);
    const goal = 'Increment counter.txt to 3 — exactly one step per turn';
    const seq = [
      { goal, status: 'active', turnsUsed: 0, maxTurns: 3 },
      { goal, status: 'active', turnsUsed: 1, maxTurns: 3, lastVerdict: 'continue', lastReason: 'counter is 1 — below target' },
      { goal, status: 'active', turnsUsed: 2, maxTurns: 3, lastVerdict: 'continue', lastReason: 'counter is 2 — one more to go' },
      { goal, status: 'done', turnsUsed: 3, maxTurns: 3, lastVerdict: 'done', lastReason: 'counter reached 3 — goal achieved' },
    ];
    for (const g of seq) {
      store.setGoalStatus(id, g);
      await new Promise((r) => setTimeout(r, 300));
    }
  });

  await pilot.page.waitForTimeout(900);
  await pilot.screenshot(OUT, { fullPage: false });
  console.log('shot', OUT);
} finally {
  await pilot.close();
}
