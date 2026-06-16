/**
 * Execution-discipline guidance — the highest-leverage prompt block borrowed
 * from the Hermes Agent prompt audit (2026-06-16). Hermes ships an always-on
 * `TASK_COMPLETION_GUIDANCE` + `<tool_persistence>` / `<mandatory_tool_use>` /
 * `<verification>` set that pushes the model to *act with tools and deliver a
 * verified artifact* rather than describe one. Code Buddy previously had only a
 * gated `workflow-rules` Verification Contract (off for simple/lite queries) and
 * no anti-stub / tool-persistence / mandatory-tool guidance at all.
 *
 * Kept short (~12 lines, ~150 tokens) and model-agnostic. Gated off for
 * trivial/lite queries and for models without tool-call support
 * (see prompt-builder.ts gating).
 */
export function getExecutionDisciplineBlock(): string {
  return [
    '## Execution discipline',
    'You take ACTION with tools — you do not describe what you would do. Each response either makes',
    'progress via tool calls or delivers a verified final result.',
    '- The deliverable is a working artifact backed by real tool output, not a description of one.',
    '  Do not stop after writing a stub, a plan, or a single command.',
    '- Keep using tools until (1) the task is complete AND (2) you have verified the result with a tool',
    '  (test output, file read-back, command exit code). Never claim success you have not verified.',
    '- For anything checkable — file contents, git state, arithmetic, current time, command results —',
    '  ALWAYS use a tool. Never guess or fabricate tool output.',
    '- Before finalizing, self-check: Correctness (every requirement met?), Grounding (claims backed by',
    '  tool output?), Scope (no unintended file changes?).',
  ].join('\n');
}
