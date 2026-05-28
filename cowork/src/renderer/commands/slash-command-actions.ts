/**
 * Renderer-side application of slash-command results.
 *
 * The SlashCommandBridge (main process) decides *what* a slash command does —
 * render engine output, forward a prompt to the LLM, or apply a presentation-only
 * `ui_effect`. This module applies that decision inside the Cowork renderer. It
 * deliberately does NOT re-implement command behaviour: the engine behaviour
 * already ran headlessly in the main process, and we only render / forward /
 * apply the small set of presentation effects here.
 *
 * @module renderer/commands/slash-command-actions
 */

import { useAppStore } from '../store';
import type { Message, TextContent } from '../types';

/** Mirror of the SlashCommandBridge execute result (see preload `command.execute`). */
export interface SlashExecuteResult {
  success: boolean;
  prompt?: string;
  message?: string;
  output?: string;
  error?: string;
  handled?: boolean;
  action?: {
    type: 'open_schedule' | 'create_schedule' | 'ui_effect';
    uiEffect?: 'open_model_picker' | 'run_orchestrator' | 'open_orchestrator_launcher' | 'open_fleet' | 'set_plan_mode' | 'open_lessons' | 'open_team';
    args?: string[];
  };
}

export interface SlashActionContext {
  /** Command name without the leading slash (for notice prefixes). */
  commandName: string;
  /** Active session id, required to render engine output as a chat message. */
  activeSessionId: string | null;
  /** Forwards a resolved prompt to the LLM (ChatView's continueSession closure). */
  continueWithPrompt: (prompt: string) => void | Promise<void>;
}

function notice(type: 'info' | 'success' | 'error', message: string): void {
  useAppStore.getState().setGlobalNotice({ id: `slash-${type}-${Date.now()}`, type, message });
}

/** Render engine command output as a local assistant message in the active session. */
function renderOutput(sessionId: string, output: string): void {
  const message: Message = {
    id: crypto.randomUUID(),
    sessionId,
    role: 'assistant',
    content: [{ type: 'text', text: output } as TextContent],
    timestamp: Date.now(),
  };
  useAppStore.getState().addMessage(sessionId, message);
}

/**
 * Launch a multi-agent run via Cowork's NATIVE orchestrator bridge. This is the
 * path whose `subagent.*` events the always-mounted SubAgentPanel observes, so
 * the agents appear live in the chat. (The headless CLI `handleSwarm` would
 * spawn into a separate, terminal-only MultiAgentSystem the panel never sees.)
 */
function runOrchestrator(goal: string, ctx: SlashActionContext): void {
  if (!ctx.activeSessionId) {
    notice('error', 'Aucune session active pour lancer un swarm.');
    return;
  }
  if (!goal) {
    useAppStore.getState().setShowOrchestratorLauncher(true);
    return;
  }
  const maxRounds = useAppStore.getState().lastOrchestratorOptions?.maxRounds ?? 3;
  // `/swarm` and `/parallel` both imply the parallel strategy (matches the CLI).
  void window.electronAPI?.orchestrator
    ?.run(ctx.activeSessionId, goal, { strategy: 'parallel', maxRounds })
    .catch((err: unknown) => {
      notice('error', `Swarm échoué : ${err instanceof Error ? err.message : String(err)}`);
    });
  notice('success', `Swarm lancé (parallel) : ${goal}`);
}

function applyUiEffect(result: SlashExecuteResult, ctx: SlashActionContext): void {
  const action = result.action;
  if (!action || action.type !== 'ui_effect') return;

  switch (action.uiEffect) {
    case 'open_model_picker': {
      const target = action.args?.[0];
      if (target) {
        void window.electronAPI?.model?.switch(target);
        const cfg = useAppStore.getState().appConfig;
        if (cfg) useAppStore.getState().setAppConfig({ ...cfg, model: target });
        notice('success', `Modèle : ${target}`);
      } else {
        notice('info', 'Choisis un modèle via le sélecteur en haut, ou utilise /model <nom>.');
      }
      break;
    }
    case 'run_orchestrator':
      runOrchestrator((action.args ?? []).join(' ').trim(), ctx);
      break;
    case 'open_orchestrator_launcher':
      useAppStore.getState().setShowOrchestratorLauncher(true);
      break;
    case 'open_fleet':
      useAppStore.getState().setShowFleetCommandCenter(true);
      break;
    case 'set_plan_mode':
      void window.electronAPI?.permission?.setMode('plan');
      useAppStore.getState().setPermissionMode('plan');
      notice('success', 'Mode plan activé (lecture seule).');
      break;
    case 'open_lessons':
      useAppStore.getState().setShowLessonCandidatePanel(true);
      break;
    case 'open_team':
      useAppStore.getState().setShowTeamPanel(true);
      break;
  }
}

/**
 * Apply a non-schedule slash-command result. Schedule actions
 * (`open_schedule` / `create_schedule`) are handled by ChatView directly,
 * because they depend on ChatView-local state.
 *
 * @returns true when the result was fully applied here (caller should clear the
 * input and stop), false when there was nothing to do (caller falls through).
 */
export function applySlashCommandResult(result: SlashExecuteResult, ctx: SlashActionContext): boolean {
  // 1. Presentation-only effect (model switch, orchestrator launch, panels).
  if (result.action?.type === 'ui_effect') {
    applyUiEffect(result, ctx);
    return true;
  }

  // 2. Engine output → render as an assistant chat message.
  if (result.output && ctx.activeSessionId) {
    renderOutput(ctx.activeSessionId, result.output);
    return true;
  }

  // 3. Handled with only a toast (info / denied / "not yet pilotable").
  if (result.handled) {
    if (result.message) {
      notice('info', ctx.commandName ? `/${ctx.commandName}: ${result.message}` : result.message);
    }
    return true;
  }

  // 4. A prompt to forward to the LLM.
  if (result.success && result.prompt) {
    void ctx.continueWithPrompt(result.prompt);
    return true;
  }

  // 5. Error.
  if (result.error) {
    notice('error', result.error);
    return true;
  }

  return false;
}
