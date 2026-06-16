import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function prepareWorkspace(appPage: Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }

  const repoRoot = path.resolve(process.cwd(), '..');
  const workdirResult = await appPage.evaluate(
    async (workspacePath) =>
      window.electronAPI?.invoke?.({
        type: 'workdir.set',
        payload: { path: workspacePath },
      }),
    repoRoot
  );
  expect(workdirResult).toMatchObject({ success: true });
  return repoRoot;
}

async function seedActiveSession(appPage: Page, repoRoot: string) {
  await appPage.evaluate((workspacePath) => {
    const now = Date.now();
    const store = (
      window as unknown as {
        useAppStore?: { getState: () => Record<string, (...args: unknown[]) => void> };
      }
    ).useAppStore?.getState();
    const session = {
      id: 'session-deep-proof',
      title: 'Deep feature proof session',
      status: 'idle',
      cwd: workspacePath,
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: true,
      model: 'gpt-5.5',
      projectId: 'project-deep-proof',
      createdAt: now - 12_000,
      updatedAt: now,
    };
    store?.setWorkingDir?.(workspacePath);
    store?.setActiveProjectId?.('project-deep-proof');
    store?.setSessions?.([session]);
    store?.setActiveSession?.(session.id);
    store?.setMessages?.(session.id, [
      {
        id: 'msg-user-proof',
        sessionId: session.id,
        role: 'user',
        timestamp: now - 10_000,
        content: [{ type: 'text', text: 'FOCUS_PANEL_OK: validate every partial panel.' }],
      },
      {
        id: 'msg-assistant-proof',
        sessionId: session.id,
        role: 'assistant',
        timestamp: now - 8_000,
        executionTimeMs: 420,
        content: [{ type: 'text', text: 'FOCUS_RESPONSE_OK: panel proof accepted.' }],
      },
    ]);
    store?.setTraceSteps?.(session.id, [
      {
        id: 'trace-proof',
        title: 'FEATURE_COMPLETION_TRACE_OK',
        timestamp: now - 7_000,
        status: 'completed',
      },
    ]);
  }, repoRoot);
}

async function installDeepFeatureMocks(electronApp: ElectronApplication) {
  await electronApp.evaluate(({ ipcMain }) => {
    const reset = (channel: string) => {
      try {
        ipcMain.removeHandler(channel);
      } catch {
        /* not registered */
      }
    };
    const channels = [
      'clipboard.summarizeNow',
      'clipboard.setMonitoring',
      'clipboard.status',
      'orchestrator.run',
      'fleet.list',
      'fleet.refreshCapabilities',
      'fleet.dispatch',
      'fleet.listSagas',
      'activity.recent',
      'activity.clear',
      'bookmarks.list',
      'bookmarks.remove',
      'sessionInsights.list',
      'sessionInsights.search',
      'sessionInsights.detail',
      'sessionInsights.audit',
      'sessionInsights.repair',
      'workflow.list',
      'workflow.create',
      'workflow.update',
      'workflow.run',
      'lessonCandidate.list',
      'lessonCandidate.approve',
      'lessonCandidate.discard',
      'userModel.list',
      'userModel.summarize',
      'userModel.accept',
      'userModel.discard',
      'spec.listProjects',
      'spec.createProject',
      'spec.sprintStatus',
      'spec.planStatus',
      'spec.listStories',
      'spec.addStory',
      'spec.approveStory',
      'spec.startStory',
      'spec.completeStory',
      'spec.blockStory',
      'spec.reopenStory',
      'spec.next',
      'mcp.registry',
      'mcp.registryTools',
      'mcp.listAllTools',
      'mcp.invokeTool',
      'plugins.listInstalled',
      'plugins.listCatalog',
      'plugins.setEnabled',
      'plugins.setComponentEnabled',
      'plugins.install',
    ];
    channels.forEach(reset);

    let clipboardMonitoring = false;
    ipcMain.handle('clipboard.status', async () => ({ monitoringEnabled: clipboardMonitoring }));
    ipcMain.handle('clipboard.setMonitoring', async (_event, enabled: boolean) => {
      clipboardMonitoring = enabled;
      return { ok: true, monitoringEnabled: enabled };
    });
    ipcMain.handle('clipboard.summarizeNow', async () => ({
      ok: true,
      payload: {
        summary: 'CLIPBOARD_PANEL_OK: clipboard text summarized from a real panel action.',
        sourcePreview: 'A long copied source preview for the deep validation scenario',
        sourceLength: 247,
        at: Date.now(),
      },
    }));

    ipcMain.handle('orchestrator.run', async (_event, sessionId: string, goal: string, options) => ({
      ok: true,
      sessionId,
      goal,
      options,
    }));

    const fleetPeer = {
      id: 'peer-e2e',
      url: 'ws://127.0.0.1:3999/ws',
      label: 'E2E Fleet Peer',
      addedAt: Date.now() - 5_000,
      status: 'authenticated',
      lastSeenAt: Date.now() - 1_000,
      capability: {
        egress: 'local',
        machineLabel: 'E2E workstation',
        maxConcurrency: 2,
        activeRequests: 0,
        models: [
          {
            id: 'gpt-5.5',
            contextWindow: 200000,
            strengths: ['code', 'review'],
            provider: 'chatgpt',
            avgLatencyMs: 1200,
          },
        ],
      },
    };
    ipcMain.handle('fleet.list', async () => [fleetPeer]);
    ipcMain.handle('fleet.refreshCapabilities', async () => ({ success: true, peer: fleetPeer }));
    ipcMain.handle('fleet.listSagas', async () => []);
    ipcMain.handle('fleet.dispatch', async (_event, input) => ({
      ok: true,
      sagaId: 'saga-e2e-dispatch',
      privacyTag: input.privacyTag,
      dispatchProfile: input.dispatchProfile,
    }));

    const activityEntries = [
      {
        id: 4101,
        type: 'fleet.dispatch',
        title: 'FLEET_ACTIVITY_OK',
        description: 'Fleet dispatch recorded by the deep validation harness',
        timestamp: Date.now() - 3_000,
        projectId: 'project-deep-proof',
        sessionId: 'session-deep-proof',
        metadata: { source: 'fleet-command-center', sagaId: 'saga-e2e-dispatch' },
      },
      {
        id: 4102,
        type: 'scheduledTask.started',
        title: 'SCHEDULED_ACTIVITY_OK',
        description: 'Scheduled task activity recorded by the deep validation harness',
        timestamp: Date.now() - 2_000,
        projectId: 'project-deep-proof',
        metadata: { taskTitle: 'QA panel scheduled proof', source: 'schedule' },
      },
    ];
    ipcMain.handle('activity.recent', async () => activityEntries);
    ipcMain.handle('activity.clear', async () => ({ success: true }));

    let bookmarks = [
      {
        id: 501,
        sessionId: 'session-deep-proof',
        projectId: 'project-deep-proof',
        messageId: 'msg-user-proof',
        preview: 'BOOKMARK_PANEL_OK: bookmarked message preview',
        note: 'Deep validation bookmark note',
        role: 'user',
        createdAt: Date.now() - 4_000,
      },
    ];
    ipcMain.handle('bookmarks.list', async () => bookmarks);
    ipcMain.handle('bookmarks.remove', async (_event, id: number) => {
      bookmarks = bookmarks.filter((bookmark) => bookmark.id !== id);
      return { success: true };
    });

    const insightSummary = {
      sessionId: 'session-deep-proof',
      title: 'Deep feature proof session',
      status: 'completed',
      model: 'gpt-5.5',
      cwd: 'D:/CascadeProjects/grok-cli-weekend',
      createdAt: Date.now() - 12_000,
      updatedAt: Date.now() - 1_000,
      messageCount: 2,
      userMessageCount: 1,
      assistantMessageCount: 1,
      toolCallCount: 1,
      tokenInput: 120,
      tokenOutput: 80,
      totalTokens: 200,
      totalExecutionTimeMs: 420,
      transcriptPreview: 'SESSION_INSIGHTS_OK transcript preview',
      matchSnippet: 'SESSION_INSIGHTS_OK match',
      matchCount: 1,
      matchMessageId: 'msg-user-proof',
    };
    const insightDetail = {
      summary: insightSummary,
      messages: [
        {
          id: 'msg-user-proof',
          sessionId: 'session-deep-proof',
          role: 'user',
          timestamp: Date.now() - 10_000,
          content: [{ type: 'text', text: 'SESSION_INSIGHTS_OK user transcript' }],
        },
        {
          id: 'msg-assistant-proof',
          sessionId: 'session-deep-proof',
          role: 'assistant',
          timestamp: Date.now() - 8_000,
          content: [{ type: 'text', text: 'SESSION_INSIGHTS_OK assistant transcript' }],
        },
      ],
      traceSteps: [{ id: 'trace-proof', title: 'SESSION_TRACE_OK', status: 'completed' }],
    };
    const audit = {
      sessionId: 'session-deep-proof',
      issueCount: 0,
      orphanToolResults: 0,
      missingToolResults: 0,
      emptyMessages: 0,
      issues: [],
    };
    ipcMain.handle('sessionInsights.list', async () => [insightSummary]);
    ipcMain.handle('sessionInsights.search', async () => [insightSummary]);
    ipcMain.handle('sessionInsights.detail', async () => insightDetail);
    ipcMain.handle('sessionInsights.audit', async () => audit);
    ipcMain.handle('sessionInsights.repair', async () => ({ audit, messages: insightDetail.messages }));

    let workflows = [
      {
        id: 'workflow-existing',
        name: 'WORKFLOW_PANEL_OK existing workflow',
        description: 'Runnable workflow fixture',
        nodes: [
          { id: 'start', type: 'start', name: 'Start', position: { x: 80, y: 120 } },
          { id: 'end', type: 'end', name: 'End', position: { x: 420, y: 120 } },
        ],
        edges: [{ id: 'edge-start-end', source: 'start', target: 'end' }],
        createdAt: Date.now() - 20_000,
        updatedAt: Date.now() - 10_000,
      },
    ];
    ipcMain.handle('workflow.list', async () => workflows);
    ipcMain.handle('workflow.create', async (_event, definition) => {
      const workflow = {
        ...definition,
        id: 'workflow-created',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      workflows = [workflow, ...workflows];
      return workflow;
    });
    ipcMain.handle('workflow.update', async (_event, id: string, patch) => {
      workflows = workflows.map((workflow) =>
        workflow.id === id ? { ...workflow, ...patch, updatedAt: Date.now() } : workflow
      );
      return workflows.find((workflow) => workflow.id === id);
    });
    ipcMain.handle('workflow.run', async () => ({
      success: true,
      status: 'WORKFLOW_RUN_OK',
      completedSteps: 2,
      totalSteps: 2,
    }));

    let lessonCandidates = [
      {
        id: 'lesson-e2e',
        content: 'LESSON_PANEL_OK: proposed durable lesson',
        category: 'PATTERN',
        status: 'pending',
        createdAt: Date.now() - 6_000,
        context: 'deep validation',
      },
    ];
    ipcMain.handle('lessonCandidate.list', async (_event, status?: string) => ({
      ok: true,
      items: lessonCandidates.filter((item) => !status || item.status === status),
    }));
    ipcMain.handle('lessonCandidate.approve', async (_event, id: string, input) => {
      lessonCandidates = lessonCandidates.map((item) =>
        item.id === id
          ? { ...item, status: 'approved', reviewedBy: input.reviewedBy, approvedLessonId: 'lesson-approved-e2e' }
          : item
      );
      return { ok: true };
    });
    ipcMain.handle('lessonCandidate.discard', async () => ({ ok: true }));

    let observations = [
      {
        id: 'observation-e2e',
        kind: 'working-style',
        status: 'pending',
        content: 'USER_MODEL_PANEL_OK: prefers evidence-backed feature completion',
        confidence: 0.96,
        createdAt: Date.now() - 7_000,
      },
    ];
    ipcMain.handle('userModel.list', async (_event, status?: string) => ({
      ok: true,
      items: observations.filter((item) => !status || item.status === status),
    }));
    ipcMain.handle('userModel.summarize', async () => ({
      ok: true,
      summary: 'USER_MODEL_SUMMARY_OK: accepted observations are summarized here.',
    }));
    ipcMain.handle('userModel.accept', async (_event, id: string, input) => {
      observations = observations.map((item) =>
        item.id === id ? { ...item, status: 'accepted', reviewedBy: input.reviewedBy } : item
      );
      return { ok: true };
    });
    ipcMain.handle('userModel.discard', async () => ({ ok: true }));

    let specProjects = [
      {
        id: 'spec-existing',
        title: 'SPEC_PANEL_OK existing project',
        phase: 'stories',
        createdAt: Date.now() - 8_000,
        updatedAt: Date.now() - 5_000,
      },
    ];
    let stories = [
      {
        id: 'story-e2e',
        title: 'SPEC_STORY_OK validate backlog panel',
        narrative: 'Exercise create/add/approve flow in the GUI.',
        status: 'draft',
        createdAt: Date.now() - 5_000,
        updatedAt: Date.now() - 5_000,
      },
    ];
    const sprintStatus = () => ({
      total: stories.length,
      byStatus: {
        draft: stories.filter((story) => story.status === 'draft').length,
        approved: stories.filter((story) => story.status === 'approved').length,
        in_progress: stories.filter((story) => story.status === 'in_progress').length,
        done: stories.filter((story) => story.status === 'done').length,
        blocked: stories.filter((story) => story.status === 'blocked').length,
      },
    });
    ipcMain.handle('spec.listProjects', async () => ({ ok: true, projects: specProjects }));
    ipcMain.handle('spec.createProject', async (_event, title: string) => {
      const project = {
        id: 'spec-created',
        title,
        phase: 'stories',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      specProjects = [project, ...specProjects];
      return { ok: true, project };
    });
    ipcMain.handle('spec.sprintStatus', async () => ({ ok: true, status: sprintStatus() }));
    ipcMain.handle('spec.planStatus', async () => ({
      ok: true,
      status: { phase: 'stories', prd: true, architecture: true, stories: stories.length },
    }));
    ipcMain.handle('spec.listStories', async () => ({ ok: true, stories }));
    ipcMain.handle('spec.addStory', async (_event, _projectId: string, input) => {
      const story = {
        id: 'story-created',
        title: input.title,
        narrative: input.narrative,
        status: 'draft',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      stories = [story, ...stories];
      return { ok: true, story };
    });
    ipcMain.handle('spec.approveStory', async (_event, _projectId: string, storyId: string, reviewedBy: string) => {
      stories = stories.map((story) =>
        story.id === storyId ? { ...story, status: 'approved', reviewedBy } : story
      );
      return { ok: true };
    });
    ipcMain.handle('spec.startStory', async () => ({ ok: true }));
    ipcMain.handle('spec.completeStory', async () => ({ ok: true }));
    ipcMain.handle('spec.blockStory', async () => ({ ok: true }));
    ipcMain.handle('spec.reopenStory', async () => ({ ok: true }));
    ipcMain.handle('spec.next', async () => ({ ok: true, stdout: 'SPEC_NEXT_OK dry run' }));

    const mcpItem = {
      id: 'browser-e2e',
      name: 'Browser E2E MCP',
      description: 'MCP_MARKETPLACE_OK browser connector fixture',
      category: 'browser',
      bundled: true,
      tags: ['browser', 'qa'],
      type: 'stdio',
      command: 'node',
      args: ['browser-e2e.js'],
      publisher: 'Code Buddy QA',
      installed: true,
      installedServerId: 'server-browser-e2e',
      enabled: true,
    };
    const mcpTool = {
      name: 'mcp__browser_e2e__ping',
      description: 'MCP_PLAYGROUND_OK ping tool',
      serverId: 'server-browser-e2e',
      serverName: 'Browser E2E MCP',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
        },
      },
    };
    ipcMain.handle('mcp.registry', async () => [mcpItem]);
    ipcMain.handle('mcp.registryTools', async () => [mcpTool]);
    ipcMain.handle('mcp.listAllTools', async () => [mcpTool]);
    ipcMain.handle('mcp.invokeTool', async (_event, name: string, args) => ({
      success: true,
      durationMs: 12,
      result: { marker: 'MCP_PLAYGROUND_OK', name, args },
    }));

    let installedPlugins = [
      {
        pluginId: 'plugin-e2e',
        name: 'PLUGIN_PANEL_OK installed plugin',
        version: '1.0.0',
        description: 'Installed plugin fixture',
        authorName: 'Code Buddy QA',
        enabled: true,
        sourcePath: 'D:/tmp/plugin-e2e',
        componentCounts: { skills: 1, commands: 1, agents: 0, hooks: 0, mcp: 1 },
        componentsEnabled: { skills: true, commands: true, agents: false, hooks: false, mcp: true },
      },
    ];
    const catalogPlugins = [
      {
        name: 'PLUGIN_CATALOG_OK',
        version: '1.0.0',
        description: 'Catalog plugin fixture',
        authorName: 'Code Buddy QA',
        installable: true,
      },
    ];
    ipcMain.handle('plugins.listInstalled', async () => installedPlugins);
    ipcMain.handle('plugins.listCatalog', async () => catalogPlugins);
    ipcMain.handle('plugins.setEnabled', async (_event, pluginId: string, enabled: boolean) => {
      installedPlugins = installedPlugins.map((plugin) =>
        plugin.pluginId === pluginId ? { ...plugin, enabled } : plugin
      );
      return { success: true };
    });
    ipcMain.handle(
      'plugins.setComponentEnabled',
      async (_event, pluginId: string, component: string, enabled: boolean) => {
        installedPlugins = installedPlugins.map((plugin) =>
          plugin.pluginId === pluginId
            ? {
                ...plugin,
                componentsEnabled: { ...plugin.componentsEnabled, [component]: enabled },
              }
            : plugin
        );
        return { success: true };
      }
    );
    ipcMain.handle('plugins.install', async (_event, name: string) => {
      installedPlugins = [
        ...installedPlugins,
        {
          pluginId: `installed-${name}`,
          name,
          version: '1.0.0',
          description: 'Installed from catalog in e2e',
          authorName: 'Code Buddy QA',
          enabled: true,
          sourcePath: `D:/tmp/${name}`,
          componentCounts: { skills: 1, commands: 0, agents: 0, hooks: 0, mcp: 0 },
          componentsEnabled: { skills: true, commands: false, agents: false, hooks: false, mcp: false },
        },
      ];
      return { success: true };
    });
  });
}

test.beforeEach(async ({ electronApp, appPage }) => {
  await installDeepFeatureMocks(electronApp);
  const repoRoot = await prepareWorkspace(appPage);
  await seedActiveSession(appPage, repoRoot);
});

test('uses clipboard summary, orchestrator, and Fleet command dispatch', async ({ appPage }) => {
  test.setTimeout(180_000);

  await appPage.getByTestId('clipboard-summary-button').click();
  await expect(appPage.getByTestId('clipboard-summary-panel')).toBeVisible();
  await appPage.getByTestId('clipboard-summarize-now').click();
  await expect(appPage.getByTestId('clipboard-summary-text')).toContainText('CLIPBOARD_PANEL_OK');
  await appPage.getByTestId('clipboard-monitor-toggle').click();
  await appPage.getByTestId('clipboard-summary-panel').getByLabel('Close').click();

  await appPage.getByText('Outils').click();
  await appPage.getByText('Orchestrateur').click();
  await expect(appPage.getByTestId('orchestrator-launcher')).toBeVisible();
  await appPage.getByTestId('orchestrator-goal-input').fill('ORCHESTRATOR_PANEL_OK: prove team launch');
  await appPage.getByTestId('orchestrator-strategy-select').selectOption('peer_review');
  await appPage.getByTestId('orchestrator-rounds-input').fill('2');
  await appPage.getByTestId('orchestrator-spawn-button').click();
  await expect(appPage.getByTestId('orchestrator-launcher')).toHaveCount(0);

  await appPage.getByRole('button', { name: 'Outils' }).click();
    await appPage.getByRole('button', { name: 'Fleet' }).click();
  await expect(appPage.getByTestId('fleet-command-center')).toBeVisible();
  await expect(appPage.getByText('E2E Fleet Peer')).toBeVisible();
  await appPage.getByTestId('fleet-command-goal-input').fill('FLEET_COMMAND_OK: dispatch this proof');
  await appPage.getByTestId('fleet-command-privacy-select').selectOption('sensitive');
  await appPage.getByTestId('fleet-command-profile-select').selectOption('code');
  await appPage.getByTestId('fleet-command-dispatch-button').click();
  await expect(appPage.getByTestId('fleet-command-dispatch-feedback')).toContainText('saga');

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/36-clipboard-orchestrator-fleet-used.png'
    ),
    fullPage: true,
  });
});

test('uses bookmarks, activity, session insights, and focus view with seeded data', async ({
  appPage,
}) => {
  test.setTimeout(180_000);

  await appPage.getByText('Vue').click();
  await appPage.getByText('Signets').click();
  await expect(appPage.getByTestId('bookmarks-panel')).toBeVisible();
  await appPage.getByTestId('bookmarks-search-input').fill('BOOKMARK_PANEL_OK');
  await expect(appPage.getByTestId('bookmark-row-501')).toContainText('BOOKMARK_PANEL_OK');
  await appPage.getByTestId('bookmarks-scope-all').click();
  await expect(appPage.getByTestId('bookmark-row-501')).toBeVisible();
  await appPage.evaluate(() => {
    (
      window as unknown as {
        useAppStore?: { getState: () => { setShowBookmarksPanel?: (show: boolean) => void } };
      }
    ).useAppStore?.getState().setShowBookmarksPanel?.(false);
  });

  await appPage.getByRole('button', { name: 'Vue' }).click();
    await appPage.getByRole('button', { name: 'Activité' }).click();
  await expect(appPage.getByTestId('activity-feed')).toBeVisible();
  await appPage.getByTestId('activity-filter-fleet').click();
  await expect(appPage.getByTestId('activity-entry-4101')).toContainText('FLEET_ACTIVITY_OK');
  await appPage.getByTestId('activity-filter-scheduled').click();
  await expect(appPage.getByTestId('activity-entry-4102')).toContainText('SCHEDULED_ACTIVITY_OK');
  await appPage.evaluate(() => {
    (
      window as unknown as {
        useAppStore?: { getState: () => { setShowActivityFeed?: (show: boolean) => void } };
      }
    ).useAppStore?.getState().setShowActivityFeed?.(false);
  });

  await appPage.getByText('Outils').click();
  await appPage.getByText('Insights').click();
  await expect(appPage.getByTestId('session-insights-panel')).toBeVisible();
  await appPage.getByTestId('session-insights-search').fill('SESSION_INSIGHTS_OK');
  await expect(appPage.getByTestId('session-insights-row-session-deep-proof')).toContainText(
    'Deep feature proof session'
  );
  await appPage.getByTestId('session-insights-audit-button').click();
  await expect(appPage.getByTestId('session-insights-audit-result')).toContainText(
    'No transcript issues detected'
  );
  await appPage.evaluate(() => {
    (
      window as unknown as {
        useAppStore?: { getState: () => { setShowSessionInsights?: (show: boolean) => void } };
      }
    ).useAppStore?.getState().setShowSessionInsights?.(false);
  });

  await appPage.getByText('Vue').click();
  await appPage.getByText('Focus').click();
  await expect(appPage.getByTestId('focus-view')).toContainText('FOCUS_PANEL_OK');
  await expect(appPage.getByTestId('focus-view')).toContainText('FOCUS_RESPONSE_OK');
  await appPage.getByTestId('focus-view-open-insights').click();
  await expect(appPage.getByTestId('session-insights-panel')).toBeVisible();

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/37-knowledge-panels-used.png'
    ),
    fullPage: true,
  });
});

test('uses workflow, lesson, user-model, and spec backlog review flows', async ({ appPage }) => {
  test.setTimeout(240_000);

  await appPage.getByText('Fichier', { exact: true }).click();
    await appPage.getByText('Paramètres').click();
  await appPage.getByTestId('settings-tab-workflows').scrollIntoViewIfNeeded();
  await appPage.getByTestId('settings-tab-workflows').click();
  await expect(appPage.getByTestId('settings-workflows')).toBeVisible();
  await appPage.getByTestId('workflow-create-button').click();
  await appPage.getByTestId('workflow-editor-name-input').fill('WORKFLOW_CREATED_OK');
  await appPage.getByTestId('workflow-add-node-tool').click();
  await appPage.getByTestId('workflow-editor-save').click();
  await expect(appPage.getByTestId('workflow-row-workflow-created')).toContainText(
    'WORKFLOW_CREATED_OK'
  );
  await appPage.getByTestId('workflow-run-workflow-created').click();
  await expect(appPage.getByTestId('workflow-run-result')).toContainText('WORKFLOW_RUN_OK');
  await appPage.evaluate(() => {
    (
      window as unknown as {
        useAppStore?: { getState: () => { setShowSettings?: (show: boolean) => void } };
      }
    ).useAppStore?.getState().setShowSettings?.(false);
  });

  await appPage.getByText('Outils').click();
  await appPage.getByText('Leçons').click();
  await expect(appPage.getByTestId('lesson-candidate-panel')).toBeVisible();
  await expect(appPage.getByTestId('lesson-candidate')).toContainText('LESSON_PANEL_OK');
  await appPage.getByTestId('lesson-reviewer-input').fill('Patrice QA');
  await appPage.getByTestId('lesson-approve-lesson-e2e').click();
  await appPage.getByTestId('lesson-tab-all').click();
  await expect(appPage.getByTestId('lesson-candidate')).toContainText('approved by Patrice QA');
  await appPage.evaluate(() => {
    (
      window as unknown as {
        useAppStore?: { getState: () => { setShowLessonCandidatePanel?: (show: boolean) => void } };
      }
    ).useAppStore?.getState().setShowLessonCandidatePanel?.(false);
  });

  await appPage.getByText('Outils').click();
  await appPage.getByText('Modèle Utilisateur').click();
  await expect(appPage.getByTestId('user-model-panel')).toBeVisible();
  await expect(appPage.getByTestId('user-observation')).toContainText('USER_MODEL_PANEL_OK');
  await appPage.getByTestId('user-model-reviewer-input').fill('Patrice QA');
  await appPage.getByTestId('user-model-accept-observation-e2e').click();
  await appPage.getByTestId('user-model-tab-all').click();
  await expect(appPage.getByTestId('user-observation')).toContainText('accepted by Patrice QA');
  await appPage.evaluate(() => {
    (
      window as unknown as {
        useAppStore?: { getState: () => { setShowUserModelPanel?: (show: boolean) => void } };
      }
    ).useAppStore?.getState().setShowUserModelPanel?.(false);
  });

  await appPage.getByText('Outils').click();
  await appPage.getByText('Specs').click();
  await expect(appPage.getByTestId('spec-panel')).toBeVisible();
  await appPage.getByTestId('spec-project-title-input').fill('SPEC_PROJECT_CREATED_OK');
  await appPage.getByTestId('spec-project-create').click();
  await expect(appPage.getByTestId('spec-panel')).toContainText('SPEC_PROJECT_CREATED_OK');
  await appPage.getByTestId('spec-add-story-open').click();
  await appPage.getByTestId('spec-story-title-input').fill('SPEC_STORY_CREATED_OK');
  await appPage.getByTestId('spec-story-narrative-input').fill('Backlog proof narrative');
  await appPage.getByTestId('spec-story-add-submit').click();
  await expect(appPage.getByTestId('spec-story-story-created')).toContainText(
    'SPEC_STORY_CREATED_OK'
  );
  await appPage.getByTestId('spec-story-story-created').getByRole('button', { name: 'Approve' }).click();
  await appPage.getByTestId('spec-action-value-input').fill('Patrice QA');
  await appPage.getByTestId('spec-action-confirm').click();
  await expect(appPage.getByTestId('spec-story-story-created')).toContainText('approved');

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/38-review-backlog-used.png'
    ),
    fullPage: true,
  });
});

test('uses MCP connector playground and plugin manager controls', async ({ appPage }) => {
  test.setTimeout(180_000);

  await appPage.getByText('Fichier', { exact: true }).click();
    await appPage.getByText('Paramètres').click();
  await appPage.getByTestId('settings-tab-mcpMarketplace').scrollIntoViewIfNeeded();
  await appPage.getByTestId('settings-tab-mcpMarketplace').click();
  await expect(appPage.getByTestId('settings-mcp-marketplace')).toBeVisible();
  await appPage.getByTestId('mcp-marketplace-search').fill('browser');
  await expect(appPage.getByTestId('mcp-marketplace-item-browser-e2e')).toContainText(
    'MCP_MARKETPLACE_OK'
  );
  await appPage.getByTestId('mcp-marketplace-item-browser-e2e').click();
  await expect(appPage.getByText('mcp__browser_e2e__ping')).toBeVisible();
  await appPage.getByTestId('mcp-playground-tab').click();
  await expect(appPage.getByTestId('settings-mcp-playground')).toBeVisible();
  await appPage.getByTestId('mcp-tool-mcp__browser_e2e__ping').click();
  await appPage.getByTestId('mcp-playground-args').fill('{"message":"hello"}');
  await appPage.getByTestId('mcp-playground-run').click();
  await expect(appPage.getByTestId('mcp-playground-result')).toContainText('MCP_PLAYGROUND_OK');

  await appPage.getByTestId('settings-tab-plugins').scrollIntoViewIfNeeded();
  await appPage.getByTestId('settings-tab-plugins').click();
  await expect(appPage.getByTestId('settings-plugins')).toBeVisible();
  await appPage.getByTestId('plugins-search-input').fill('PLUGIN_PANEL_OK');
  await expect(appPage.getByTestId('plugin-installed-plugin-e2e')).toContainText(
    'PLUGIN_PANEL_OK'
  );
  await appPage.getByTestId('plugin-installed-plugin-e2e').getByRole('button').first().click();
  await appPage.getByTestId('plugin-plugin-e2e-comp-skills').click();
  await appPage.getByTestId('plugins-tab-catalog').click();
  await appPage.getByTestId('plugins-search-input').fill('PLUGIN_CATALOG_OK');
  await expect(appPage.getByTestId('plugin-catalog-PLUGIN_CATALOG_OK')).toBeVisible();

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/39-connectors-plugins-used.png'
    ),
    fullPage: true,
  });
});
