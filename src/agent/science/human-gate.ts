/**
 * AI-Scientist-lite — the fail-closed human gate primitive.
 *
 * Shared by the Phase 0 orchestrator (plan + publish gates) and the Phase 1
 * empirical keep-gate. Extracted into its own module so both can REUSE the exact
 * same fail-closed resolution (no reinvention, no import cycle). Only an explicit
 * `approved === true` proceeds; a decline, timeout, throw, or any other shape is
 * treated as a refusal.
 *
 * @module agent/science/human-gate
 */

/** A human gate decision. Only `approved === true` proceeds (fail closed). */
export interface GateDecision {
  approved: boolean;
  /** Optional human-supplied reason / note. */
  reason?: string;
}

/** What a gate presents to the human before they decide. */
export interface HumanGatePrompt {
  gate: 'plan' | 'publish' | 'keep';
  title: string;
  body: string;
}

/** A human-gate boundary. MAY throw / time out — the resolver fails closed. */
export type HumanGateFn = (prompt: HumanGatePrompt) => Promise<GateDecision>;

/**
 * Resolve a human gate, defaulting to REFUSED. Only an explicit
 * `approved === true` proceeds; a thrown error, timeout, or any other shape is
 * treated as a decline (fail closed).
 */
export async function resolveGate(fn: HumanGateFn, prompt: HumanGatePrompt): Promise<GateDecision> {
  try {
    const decision = await fn(prompt);
    if (decision && decision.approved === true) {
      return { approved: true, ...(decision.reason ? { reason: decision.reason } : {}) };
    }
    return {
      approved: false,
      ...(decision && decision.reason ? { reason: decision.reason } : {}),
    };
  } catch (err) {
    return { approved: false, reason: `gate error (fail-closed): ${err instanceof Error ? err.message : String(err)}` };
  }
}
