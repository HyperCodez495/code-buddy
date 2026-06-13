/**
 * Centralized Zustand store selectors.
 *
 * Rules:
 *  - All hooks use the `use` prefix.
 *  - Per-session derived state always falls back to safe empty values so
 *    callers never have to guard against undefined.
 *  - Hooks that subscribe to more than one scalar field use `useShallow` so
 *    that the component only re-renders when one of the selected values
 *    actually changes by reference / value.
 *
 * Usage example:
 *   const session = useCurrentSession();
 *   const messages = useActiveSessionMessages();
 */

import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from './index';
import type { Session, Message, TraceStep, Settings, AppConfig, QueuedIntent } from '../types';
import type { GlobalNotice, SessionExecutionClock } from './index';

// ---------------------------------------------------------------------------
// Session domain
// ---------------------------------------------------------------------------

/** Returns the full list of sessions. */
export function useSessions(): Session[] {
  return useAppStore((s) => s.sessions);
}

/** Returns the ID of the currently active session (may be null). */
export function useActiveSessionId(): string | null {
  return useAppStore((s) => s.activeSessionId);
}

/**
 * Returns the active Session object, or null when none is selected.
 * Stable reference: re-renders only when the active session object changes.
 */
export function useCurrentSession(): Session | null {
  return useAppStore(
    useShallow((s) =>
      s.activeSessionId ? (s.sessions.find((sess) => sess.id === s.activeSessionId) ?? null) : null
    )
  );
}

/** Returns whether the active session is currently executing. */
export function useIsSessionRunning(): boolean {
  return useAppStore((s) => {
    if (!s.activeSessionId) return false;
    const session = s.sessions.find((sess) => sess.id === s.activeSessionId);
    return session?.status === 'running';
  });
}

// ---------------------------------------------------------------------------
// Message domain
// ---------------------------------------------------------------------------

/**
 * Stable empty arrays — MUST NOT recreate on every getSnapshot call.
 * Returning a fresh `[]` literal would trigger an infinite re-render in
 * useSyncExternalStore (Zustand uses it under the hood: a new array
 * reference looks like a state change every time, kicking another
 * render → another getSnapshot → ad nauseam). React 18 surfaces this
 * as "Maximum update depth exceeded" + the warning "result of
 * getSnapshot should be cached to avoid an infinite loop". Bug
 * triggered when ANY component subscribes to one of these selectors
 * before the relevant slice is populated (e.g. OrchestratorLauncher
 * mounting before the first session is created).
 */
const EMPTY_MESSAGES: Message[] = [];

/** Returns the committed messages for the active session. */
export function useActiveSessionMessages(): Message[] {
  return useAppStore((s) =>
    s.activeSessionId
      ? (s.sessionStates[s.activeSessionId]?.messages ?? EMPTY_MESSAGES)
      : EMPTY_MESSAGES
  );
}

/**
 * Returns the messages for an arbitrary session by ID.
 * Useful in list components that render session previews.
 */
export function useSessionMessages(sessionId: string): Message[] {
  return useAppStore((s) => s.sessionStates[sessionId]?.messages ?? EMPTY_MESSAGES);
}

/** Returns the in-progress (streaming) text of the active session's response. */
export function useActivePartialMessage(): string {
  return useAppStore((s) =>
    s.activeSessionId ? (s.sessionStates[s.activeSessionId]?.partialMessage ?? '') : ''
  );
}

/** Returns the in-progress thinking text for the active session. */
export function useActivePartialThinking(): string {
  return useAppStore((s) =>
    s.activeSessionId ? (s.sessionStates[s.activeSessionId]?.partialThinking ?? '') : ''
  );
}

/**
 * Returns both partial message and partial thinking for the active session in
 * a single subscription so the consumer only renders once per streaming tick.
 */
export function useActivePartialContent(): { partialMessage: string; partialThinking: string } {
  return useAppStore(
    useShallow((s) => ({
      partialMessage: s.activeSessionId
        ? (s.sessionStates[s.activeSessionId]?.partialMessage ?? '')
        : '',
      partialThinking: s.activeSessionId
        ? (s.sessionStates[s.activeSessionId]?.partialThinking ?? '')
        : '',
    }))
  );
}

// ---------------------------------------------------------------------------
// Turn / execution state domain
// ---------------------------------------------------------------------------

/** Returns the active turn info for the current session (or null). */
export function useActiveTurn(): { stepId: string; userMessageId: string } | null {
  return useAppStore((s) =>
    s.activeSessionId ? (s.sessionStates[s.activeSessionId]?.activeTurn ?? null) : null
  );
}

const EMPTY_PENDING_TURNS: string[] = [];
const EMPTY_QUEUED_INTENTS: QueuedIntent[] = [];

/** Returns the list of pending turn message IDs for the active session. */
export function usePendingTurns(): string[] {
  return useAppStore((s) =>
    s.activeSessionId
      ? (s.sessionStates[s.activeSessionId]?.pendingTurns ?? EMPTY_PENDING_TURNS)
      : EMPTY_PENDING_TURNS
  );
}

/** Returns the queued user intents for the active session. */
export function useActiveQueuedIntents(): QueuedIntent[] {
  return useAppStore((s) =>
    s.activeSessionId
      ? (s.sessionStates[s.activeSessionId]?.queuedIntents ?? EMPTY_QUEUED_INTENTS)
      : EMPTY_QUEUED_INTENTS
  );
}

/**
 * Returns a summary of the execution state for the active session.
 * Combines running status, active turn, and pending count in one subscription.
 */
export function useActiveSessionExecution(): {
  isRunning: boolean;
  hasActiveTurn: boolean;
  pendingCount: number;
  canStop: boolean;
} {
  return useAppStore(
    useShallow((s) => {
      const id = s.activeSessionId;
      const session = id ? s.sessions.find((sess) => sess.id === id) : undefined;
      const isRunning = session?.status === 'running';
      const activeTurn = id ? (s.sessionStates[id]?.activeTurn ?? null) : null;
      const hasActiveTurn = Boolean(activeTurn);
      const pendingCount = id ? (s.sessionStates[id]?.pendingTurns ?? []).length : 0;
      return {
        isRunning,
        hasActiveTurn,
        pendingCount,
        canStop: isRunning || hasActiveTurn || pendingCount > 0,
      };
    })
  );
}

/** Returns the execution clock record for the active session. */
export function useActiveExecutionClock(): SessionExecutionClock | undefined {
  return useAppStore((s) =>
    s.activeSessionId ? s.sessionStates[s.activeSessionId]?.executionClock : undefined
  );
}

// ---------------------------------------------------------------------------
// Trace steps domain
// ---------------------------------------------------------------------------

const EMPTY_TRACE_STEPS: TraceStep[] = [];

/** Returns the trace steps for the active session. */
export function useActiveTraceSteps(): TraceStep[] {
  return useAppStore((s) =>
    s.activeSessionId
      ? (s.sessionStates[s.activeSessionId]?.traceSteps ?? EMPTY_TRACE_STEPS)
      : EMPTY_TRACE_STEPS
  );
}

/** Returns the context window size (token count) for the active session. */
export function useActiveContextWindow(): number | undefined {
  return useAppStore((s) =>
    s.activeSessionId ? s.sessionStates[s.activeSessionId]?.contextWindow : undefined
  );
}

// ---------------------------------------------------------------------------
// UI layout domain
// ---------------------------------------------------------------------------

/**
 * Returns sidebar and context-panel collapsed flags in a single subscription
 * so layout components don't register two separate subscriptions.
 */
export function useLayoutState(): { sidebarCollapsed: boolean; contextPanelCollapsed: boolean } {
  return useAppStore(
    useShallow((s) => ({
      sidebarCollapsed: s.sidebarCollapsed,
      contextPanelCollapsed: s.contextPanelCollapsed,
    }))
  );
}

/** Returns whether the settings panel is open, plus the active tab. */
export function useSettingsState(): { showSettings: boolean; settingsTab: string | null } {
  return useAppStore(
    useShallow((s) => ({
      showSettings: s.showSettings,
      settingsTab: s.settingsTab,
    }))
  );
}

// ---------------------------------------------------------------------------
// Config / auth domain
// ---------------------------------------------------------------------------

/** Returns the application configuration object (may be null until loaded). */
export function useAppConfig(): AppConfig | null {
  return useAppStore((s) => s.appConfig);
}

/** Returns whether the app has been configured with valid API credentials. */
export function useIsConfigured(): boolean {
  return useAppStore((s) => s.isConfigured);
}

/**
 * Returns the config-related modal/notice state in one subscription.
 * Useful in App.tsx where these flags control overlay visibility.
 */
export function useConfigModalState(): {
  showConfigModal: boolean;
  isConfigured: boolean;
  appConfig: AppConfig | null;
} {
  return useAppStore(
    useShallow((s) => ({
      showConfigModal: s.showConfigModal,
      isConfigured: s.isConfigured,
      appConfig: s.appConfig,
    }))
  );
}

// ---------------------------------------------------------------------------
// Settings domain
// ---------------------------------------------------------------------------

/** Returns the user settings object. */
export function useSettings(): Settings {
  return useAppStore((s) => s.settings);
}

/** Returns only the theme setting to avoid re-renders from unrelated settings changes. */
export function useThemeSetting(): Settings['theme'] {
  return useAppStore((s) => s.settings.theme);
}

/** Returns whether the OS is currently in dark mode. */
export function useSystemDarkMode(): boolean {
  return useAppStore((s) => s.systemDarkMode);
}

// ---------------------------------------------------------------------------
// Sandbox domain
// ---------------------------------------------------------------------------

/** Returns the current sandbox sync status. */
export function useSandboxSyncStatus() {
  return useAppStore((s) => s.sandboxSyncStatus);
}

/** Returns the sandbox setup progress and completion flag together. */
export function useSandboxSetupState() {
  return useAppStore(
    useShallow((s) => ({
      progress: s.sandboxSetupProgress,
      isComplete: s.isSandboxSetupComplete,
    }))
  );
}

// ---------------------------------------------------------------------------
// Misc domain
// ---------------------------------------------------------------------------

/** Returns the active global notice banner (or null when none). */
export function useGlobalNotice(): GlobalNotice | null {
  return useAppStore((s) => s.globalNotice);
}

/** Returns the current working directory. */
export function useWorkingDir(): string | null {
  return useAppStore((s) => s.workingDir);
}

/** Returns pending permission and sudo-password requests. */
export function usePendingDialogs() {
  return useAppStore(
    useShallow((s) => ({
      pendingPermission: s.pendingPermission,
      pendingSudoPassword: s.pendingSudoPassword,
    }))
  );
}

// ---------------------------------------------------------------------------
// Code Buddy Cowork parity selectors
// ---------------------------------------------------------------------------

import type {
  DiffPreview,
  CheckpointTimeline,
  PermissionMode,
  UpdateInfo,
  Project,
  SubAgent,
  NotificationEntry,
} from '../types';

const EMPTY_DIFF_PREVIEWS: DiffPreview[] = [];

/** Returns diff previews for a specific session. */
export function useDiffPreviews(sessionId: string | null): DiffPreview[] {
  return useAppStore((s) =>
    sessionId ? (s.diffPreviews[sessionId] ?? EMPTY_DIFF_PREVIEWS) : EMPTY_DIFF_PREVIEWS,
  );
}

/** Returns the checkpoint timeline (or null). */
export function useCheckpointTimeline(): CheckpointTimeline | null {
  return useAppStore((s) => s.checkpointTimeline);
}

/** Returns the current permission mode. */
export function usePermissionMode(): PermissionMode {
  return useAppStore((s) => s.permissionMode);
}

/** Returns update info (or null). */
export function useUpdateInfo(): UpdateInfo | null {
  return useAppStore((s) => s.updateInfo);
}

/** Returns search state. */
export function useSearchState() {
  return useAppStore(
    useShallow((s) => ({
      searchQuery: s.searchQuery,
      searchActive: s.searchActive,
    }))
  );
}

/** Returns command palette visibility. */
export function useShowCommandPalette(): boolean {
  return useAppStore((s) => s.showCommandPalette);
}

/** Returns shortcuts dialog visibility. */
export function useShowShortcutsDialog(): boolean {
  return useAppStore((s) => s.showShortcutsDialog);
}

// ---------------------------------------------------------------------------
// Projects domain (Claude Cowork parity)
// ---------------------------------------------------------------------------

/** Returns the full list of projects. */
export function useProjects(): Project[] {
  return useAppStore((s) => s.projects);
}

/** Returns the active project id (may be null). */
export function useActiveProjectId(): string | null {
  return useAppStore((s) => s.activeProjectId);
}

/** Returns the active project object, or null. */
export function useActiveProject(): Project | null {
  return useAppStore((s) => {
    if (!s.activeProjectId) return null;
    return s.projects.find((p) => p.id === s.activeProjectId) ?? null;
  });
}

/** Returns sessions filtered by the active project. */
export function useProjectFilteredSessions(): Session[] {
  return useAppStore(
    useShallow((s) => {
      if (!s.activeProjectId) return s.sessions;
      return s.sessions.filter((session) => session.projectId === s.activeProjectId);
    })
  );
}

// ---------------------------------------------------------------------------
// Sub-agents domain (Claude Cowork parity)
// ---------------------------------------------------------------------------

const EMPTY_SUB_AGENT_LIST: SubAgent[] = [];

/** Returns the sub-agents spawned for the active session. */
export function useActiveSessionSubAgents(): SubAgent[] {
  return useAppStore((s) => {
    if (!s.activeSessionId) return EMPTY_SUB_AGENT_LIST;
    return s.subAgents[s.activeSessionId] ?? EMPTY_SUB_AGENT_LIST;
  });
}

/** Returns the accumulated output for a specific sub-agent in the active session. */
export function useSubAgentOutput(agentId: string): string {
  return useAppStore((s) => {
    if (!s.activeSessionId) return '';
    return s.subAgentOutputs[s.activeSessionId]?.[agentId] ?? '';
  });
}

// ---------------------------------------------------------------------------
// Notifications domain (Claude Cowork parity)
// ---------------------------------------------------------------------------

/** Returns the full list of notifications. */
export function useNotifications(): NotificationEntry[] {
  return useAppStore((s) => s.notifications);
}

/** Returns the count of unread notifications. */
export function useUnreadNotificationCount(): number {
  return useAppStore((s) => s.notifications.filter((n) => !n.read).length);
}

/** Returns notification center visibility. */
export function useShowNotificationCenter(): boolean {
  return useAppStore((s) => s.showNotificationCenter);
}
