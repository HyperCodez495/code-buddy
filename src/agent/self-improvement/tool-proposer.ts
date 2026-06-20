/**
 * Tool proposer — authors a candidate tool for a scenario. It receives a REDACTED
 * view of the scenario (capability + visible cases only); the held-out cases are
 * never exposed, so a proposer (static or LLM) cannot overfit to them. This is the
 * structural half of the anti-gaming defence (the gate is the empirical half).
 *
 * @module agent/self-improvement/tool-proposer
 */

import type { AuthoredToolSpec } from './authored-tool-runtime.js';
import type { ToolBenchmarkScenario, ToolCase, ToolProposal } from './tool-types.js';

/** What a proposer is allowed to see — NO held-out cases. */
export interface ProposerScenarioView {
  id: string;
  capability: string;
  description: string;
  visibleCases: ToolCase[];
}

/** Redact a scenario down to what a proposer may see. */
export function toProposerView(scenario: ToolBenchmarkScenario): ProposerScenarioView {
  return {
    id: scenario.id,
    capability: scenario.capability,
    description: scenario.description,
    visibleCases: scenario.visibleCases,
  };
}

export interface ToolProposer {
  propose(view: ProposerScenarioView): Promise<ToolProposal | null>;
}

/**
 * Deterministic proposer backed by a fixture map (scenarioId → spec). Ships first
 * (testable, no LLM). The LLM proposer is Phase 3 and uses the same redacted view.
 */
export class StaticToolProposer implements ToolProposer {
  constructor(private readonly specs: Map<string, AuthoredToolSpec>) {}

  async propose(view: ProposerScenarioView): Promise<ToolProposal | null> {
    const spec = this.specs.get(view.id);
    if (!spec) return null;
    return { id: `tool-proposal:${view.id}`, targetScenarioId: view.id, spec };
  }
}
