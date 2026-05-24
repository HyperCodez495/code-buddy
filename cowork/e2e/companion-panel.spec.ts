import type { ElectronApplication, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures';

async function mockCompanionBackend(electronApp: ElectronApplication, workspacePath: string) {
  await electronApp.evaluate(({ ipcMain }, cwd) => {
    const now = new Date().toISOString();
    const stats = {
      storePath: `${cwd}/.codebuddy/companion/percepts.jsonl`,
      exists: true,
      total: 1,
      byModality: { self: 1 },
      latestTimestamp: now,
    };
    const status = {
      cwd,
      authPath: `${cwd}/.codebuddy/auth.json`,
      chatGptCredentialsPresent: true,
      model: 'gpt-5.5',
      identity: {
        soulLoaded: true,
        soulSource: `${cwd}/.codebuddy/BUDDY_SOUL.md`,
        soulIsCompanion: true,
        bootLoaded: true,
        bootSource: `${cwd}/.codebuddy/BUDDY_BOOT.md`,
        bootIsCompanion: true,
      },
      voice: {
        enabled: true,
        available: true,
        provider: 'chatgpt-pro',
        language: 'fr-FR',
        autoSend: true,
      },
      wakeWord: {
        available: true,
        engine: 'text-match',
        wakeWords: ['buddy'],
        picovoiceAccessKeyPresent: false,
      },
      tts: {
        enabled: true,
        available: true,
        provider: 'system',
        voice: 'default',
        autoSpeak: true,
      },
      camera: {
        available: false,
        ffmpegAvailable: false,
        platform: 'e2e',
        reason: 'Camera is skipped in deterministic e2e.',
      },
      percepts: stats,
    };
    const percept = {
      id: 'percept_e2e_self',
      modality: 'self',
      source: 'e2e',
      timestamp: now,
      confidence: 1,
      summary: 'Buddy is awake enough to report readiness in the cockpit.',
      payload: {},
      tags: ['e2e', 'companion'],
    };
    const mission = {
      id: 'mission_e2e_review_delta',
      title: 'Review competitor delta',
      dimension: 'companion cockpit',
      status: 'open',
      priority: 'P1',
      summary: 'Compare the cockpit loop against companion baselines.',
      recommendation: 'Keep the self-improvement loop visible and actionable.',
      sourceGapId: 'gap-e2e',
      sourceRadarId: 'radar_e2e',
      competitorRefs: ['Lisa', 'PromptCommander'],
      command: 'buddy companion improve --run-mission',
      tags: ['e2e'],
      createdAt: now,
      updatedAt: now,
    };
    const board = {
      schemaVersion: 1,
      cwd,
      storePath: `${cwd}/.codebuddy/companion/missions.json`,
      updatedAt: now,
      missions: [mission],
    };
    const radar = {
      id: 'radar_e2e',
      timestamp: now,
      cwd,
      score: 88,
      currentStrengths: ['Bidirectional voice cockpit', 'Project-scoped memory'],
      gaps: [],
      nextMoves: ['Keep the cockpit loop under e2e coverage.'],
      sourceNotes: ['Deterministic e2e backend'],
    };
    const privacyReport = {
      schemaVersion: 1,
      cwd,
      generatedAt: now,
      stores: [
        {
          kind: 'percepts',
          path: `${cwd}/.codebuddy/companion/percepts.jsonl`,
          exists: true,
          bytes: 512,
          entries: 1,
        },
      ],
      totalBytes: 512,
      totalEntries: 1,
    };

    const channels = [
      'companion.setup',
      'companion.status',
      'companion.percepts.recent',
      'companion.percepts.stats',
      'companion.self.record',
      'companion.evaluate',
      'companion.radar',
      'companion.improve',
      'companion.impulses',
      'companion.checkIn',
      'companion.missions.sync',
      'companion.missions.list',
      'companion.missions.runNext',
      'companion.safety.recent',
      'companion.safety.stats',
      'companion.cards.list',
      'companion.gateway.profile',
      'companion.skills.list',
      'companion.privacy.report',
    ];
    for (const channel of channels) ipcMain.removeHandler(channel);

    ipcMain.handle('companion.status', async () => ({ ok: true, status }));
    ipcMain.handle('companion.percepts.recent', async () => ({ ok: true, items: [percept] }));
    ipcMain.handle('companion.percepts.stats', async () => ({ ok: true, stats }));
    ipcMain.handle('companion.self.record', async () => ({ ok: true, percept }));
    ipcMain.handle('companion.setup', async () => ({
      ok: true,
      result: {
        setup: {
          cwd,
          wroteSoul: false,
          wroteBoot: false,
          skippedSoul: true,
          skippedBoot: true,
          voiceConfigured: true,
          modelConfigured: true,
          model: 'gpt-5.5',
          status,
        },
        selfPercept: percept,
      },
    }));
    ipcMain.handle('companion.evaluate', async () => ({
      ok: true,
      evaluation: {
        id: 'eval_e2e',
        timestamp: now,
        cwd,
        score: 91,
        level: 'collaborative',
        findings: [
          {
            id: 'finding_e2e',
            area: 'cockpit',
            severity: 'info',
            summary: 'The companion cockpit can be driven from a real Electron window.',
            recommendation: 'Keep this flow covered before changing companion IPC.',
            tags: ['e2e'],
          },
        ],
        strengths: ['Project-aware readiness', 'Self-improvement loop'],
        nextActions: ['Pilot the cockpit before release.'],
        perceptStats: stats,
      },
    }));
    ipcMain.handle('companion.radar', async () => ({ ok: true, radar }));
    ipcMain.handle('companion.improve', async () => ({
      ok: true,
      cycle: {
        id: 'cycle_e2e',
        timestamp: now,
        cwd,
        dryRun: false,
        recorded: true,
        radar,
        board,
        missionRun: {
          success: true,
          dryRun: false,
          message: 'Companion improvement cycle completed.',
          mission,
          board,
          brief: 'E2E improvement loop completed.',
        },
        nextActions: ['Review competitor delta'],
        perceptId: percept.id,
      },
    }));
    ipcMain.handle('companion.impulses', async () => ({
      ok: true,
      brief: {
        id: 'impulse_e2e',
        timestamp: now,
        cwd,
        summary: 'Buddy sees one next move.',
        nextPrompt: 'Ask Buddy to improve the cockpit loop.',
        impulses: [],
        context: {
          perceptTotal: 1,
          openMissions: 1,
          inProgressMissions: 0,
          safetyEvents: 0,
          latestPerceptTimestamp: now,
        },
      },
    }));
    ipcMain.handle('companion.checkIn', async () => ({
      ok: true,
      cue: {
        id: 'checkin_e2e',
        timestamp: now,
        cwd,
        mood: 'steady',
        priority: 'medium',
        spokenText: 'Je suis pret a continuer avec toi.',
        writtenText: 'Je suis pret a continuer avec toi.',
        nextPrompt: 'Continue the cockpit test.',
        evidence: [],
        brief: {
          id: 'brief_e2e',
          timestamp: now,
          cwd,
          summary: 'Ready',
          nextPrompt: 'Continue.',
          impulses: [],
          context: {
            perceptTotal: 1,
            openMissions: 1,
            inProgressMissions: 0,
            safetyEvents: 0,
          },
        },
      },
    }));
    ipcMain.handle('companion.missions.sync', async () => ({
      ok: true,
      result: { board, radarId: radar.id, created: 1, updated: 0, unchanged: 0 },
    }));
    ipcMain.handle('companion.missions.list', async () => ({ ok: true, items: [mission] }));
    ipcMain.handle('companion.missions.runNext', async () => ({
      ok: true,
      result: {
        success: true,
        dryRun: false,
        message: 'Mission completed.',
        mission,
        board,
      },
    }));
    ipcMain.handle('companion.safety.recent', async () => ({ ok: true, items: [] }));
    ipcMain.handle('companion.safety.stats', async () => ({
      ok: true,
      stats: {
        ledgerPath: `${cwd}/.codebuddy/companion/safety.jsonl`,
        exists: false,
        total: 0,
        byKind: {},
        byRisk: {},
        byStatus: {},
      },
    }));
    ipcMain.handle('companion.cards.list', async () => ({ ok: true, items: [] }));
    ipcMain.handle('companion.gateway.profile', async () => ({
      ok: true,
      profile: {
        schemaVersion: 1,
        cwd,
        storePath: `${cwd}/.codebuddy/companion/gateway.json`,
        updatedAt: now,
        defaultMode: 'assist',
        channels: [
          {
            channel: 'voice',
            enabled: true,
            mode: 'assist',
            allowOutbound: false,
            requireApprovalForTools: true,
            recordPercepts: true,
            tags: ['dialogue'],
          },
        ],
      },
    }));
    ipcMain.handle('companion.skills.list', async () => ({ ok: true, items: [] }));
    ipcMain.handle('companion.privacy.report', async () => ({ ok: true, report: privacyReport }));
  }, workspacePath);
}

async function createProjectThroughSettings(
  appPage: Page,
  userDataDir: string,
): Promise<string> {
  const workspacePath = path.join(userDataDir, 'buddy-workspace');
  mkdirSync(workspacePath, { recursive: true });

  await appPage.getByTestId('sidebar-settings-button').click();
  await expect(appPage.getByTestId('settings-panel')).toBeVisible({ timeout: 20_000 });
  await completeOnboardingForTest(appPage);
  await appPage.getByTestId('settings-tab-projects').click();

  await appPage.getByPlaceholder('Project name').fill('Buddy E2E Project');
  await appPage.getByPlaceholder('Workspace path').fill(workspacePath);
  await appPage.getByRole('button', { name: 'Create project' }).click();

  await expect(appPage.getByText('Buddy E2E Project')).toBeVisible();
  await appPage.getByRole('button', { name: 'Set active' }).click();
  await expect(appPage.getByRole('button', { name: 'Clear active' })).toBeVisible();
  await appPage.getByTestId('settings-panel').getByRole('button', { name: 'Close' }).click();

  return workspacePath;
}

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

test('drives the Buddy companion cockpit from no project to improvement loop', async ({
  electronApp,
  appPage,
  userDataDir,
}) => {
  await completeOnboardingForTest(appPage);

  await appPage.getByTestId('companion-panel-button').click();
  await expect(appPage.getByRole('heading', { name: 'Buddy companion' })).toBeVisible();
  await expect(
    appPage.getByText('Select a project before opening Buddy companion senses.'),
  ).toBeVisible();
  await appPage.getByLabel('Close companion panel').click();

  const workspacePath = await createProjectThroughSettings(appPage, userDataDir);
  await mockCompanionBackend(electronApp, workspacePath);
  await completeOnboardingForTest(appPage);

  await appPage.getByTestId('companion-panel-button').click();
  await expect(appPage.getByRole('heading', { name: 'Buddy companion' })).toBeVisible();
  await expect(appPage.getByText(workspacePath, { exact: true })).toBeVisible();
  await expect(appPage.getByText('Brain')).toBeVisible();
  await expect(appPage.getByText('Companion identity')).toBeVisible();
  await expect(appPage.getByText('Ready / chatgpt-pro')).toBeVisible();

  await appPage.getByRole('button', { name: 'Self-evaluate' }).click();
  await expect(appPage.getByText('Self-evaluation')).toBeVisible();
  await expect(appPage.getByText('Pilot the cockpit before release.')).toBeVisible();

  await appPage.getByRole('button', { name: 'Improve loop' }).click();
  await expect(appPage.getByText('Improvement loop')).toBeVisible();
  await expect(appPage.getByText('Review competitor delta')).toBeVisible();
});
