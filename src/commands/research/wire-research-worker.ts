/**
 * Wire the research-worker factory for the `buddy research` CLI paths, which
 * construct a `WideResearchOrchestrator` WITHOUT going through a CodeBuddyAgent
 * (so the agent constructor never runs to wire it). This module imports
 * CodeBuddyAgent and is imported ONLY by CLI command files — leaves outside the
 * agent↔tool-registry graph — so it introduces no import cycle.
 */

import { setResearchWorkerFactory } from '../../agent/research-worker-provider.js';

let wired = false;

/** Idempotently wire the CLI's research-worker factory (spawns real CodeBuddyAgents). */
export async function ensureResearchWorkerFactory(): Promise<void> {
  if (wired) return;
  const { CodeBuddyAgent } = await import('../../agent/codebuddy-agent.js');
  setResearchWorkerFactory(({ apiKey, baseURL, model, maxRounds }) =>
    new CodeBuddyAgent(apiKey, baseURL, model, maxRounds));
  wired = true;
}
