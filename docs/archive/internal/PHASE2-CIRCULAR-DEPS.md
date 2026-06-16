# Phase 2.1 — Circular dependencies: status + remaining plan (2026-05-29)

> Audit item 2.1. `npm run check:circular` runs **madge with `skipTypeImports: true`** (see
> `scripts/check-circular-deps.ts`) — so **type-only edges (`import type`) are NOT counted**.
> This is the key lever: many cycles are type-only edges written as value `import`s and can be
> broken by switching to `import type` (zero runtime impact).

## Done this session (verified) — Phase 2 cycles 10 → 4

1. **`agentic-coding-runner ↔ checkpoint-manager`** — checkpoint-manager imported 3 interfaces
   with a value `import`. Switched to `import type` → edge erased for madge. One line.
2. **`agentic-coding-runner → task-decomposer → edit-proposal-producer → runner`** — edit-proposal
   -producer imported the pure path helpers (`normalizeGitPath`, `isPathAllowedByContract`,
   `resolveRepoPath`) as values. Extracted them to a new dependency-free
   `src/agent/autonomous/agentic-coding-paths.ts`; runner re-exports for back-compat. Also starts
   decomposing the 8.4K-LOC god file (audit 2.2).

Gate: typecheck 0, `tests/agent/autonomous` 146/146 (incl. path-traversal security suite).

## DONE — cycle 3 (`agentic-coding-runner ↔ verification-loop`) — extracted test-first ✅

verification-loop imports 3 **runtime** functions from runner: `applyDeclaredEdits`,
`previewDeclaredEdits`, `runVerificationCommands` (+ types, already partly `import type`).

**Why it needed care (security-coupled) — handled test-first:**
- `applyDeclaredEdits` toggles a module-level flag `isApplyingEdits` that gates a **global
  monkey-patch of `fs.writeFile`** (`agentic-coding-runner.ts:40-51`) which **redacts secrets**
  on every string write *except* while applying declared edits. Extracting the function means
  relocating a **security mechanism**.
- The patch is on the **default** export `import fs from 'node:fs/promises'`. verification-loop
  uses the **namespace** form `import * as fs`. The redaction is therefore **import-style
  sensitive** — a wrong import style in the extracted module silently bypasses redaction.
- The **auto-patch path is not directly unit-tested** (only `persistRunArtifact`'s explicit
  redaction is, in `agentic-coding-runner-security.test.ts`). So a silent regression would not be
  caught by the suite — unacceptable to rush on a budget.
- `persistRunArtifact` (~20 call sites) and the helpers `truncateOutput`/`execAsync`/
  `countOccurrences` (~20 uses) are used across the runner, so the move is wide.

### How it was done (test-first)

Extract a cohesive `src/agent/autonomous/agentic-coding-edits.ts` containing the **whole coupled
cluster**, kept together so the security behavior is preserved:
`isApplyingEdits`, `originalWriteFile`, the `fs.writeFile` monkey-patch, `persistRunArtifact`,
`applyDeclaredEdits`, `previewDeclaredEdits`, `runVerificationCommands`, `isCommandNotFound`, plus
the helpers `countOccurrences`/`truncateOutput`/`execAsync` (export the ones the runner still uses).

- **`import fs from 'node:fs/promises'`** (default, exactly as runner) so the patched singleton is
  shared. Do **not** use `import * as fs` in this module.
- runner: delete the moved defs, import them back from `agentic-coding-edits.js`, re-export the
  public ones (call sites unchanged — same identifiers).
- verification-loop: import the 3 functions from `agentic-coding-edits.js`; convert its remaining
  runner imports to `import type`.
- **Added a test-first gate** `tests/agent/autonomous/agentic-coding-redaction.test.ts` (pins both
  cross-module auto-redaction AND the `isApplyingEdits` skip) — written and made to pass against
  the OLD code first, then re-run green against the extracted module.
- ✅ Verified: typecheck 0, `tests/agent/autonomous` **148/148** (incl. the redaction gate +
  path-traversal security suite), `autonomous-code-command` **60/60**, `check:circular` **8 → 7**.

## Audit continuation — cycles 4–6 removed

4. **`client ↔ provider-openai-compat`** — extracted the runtime `hasToolCalls` guard into
   `src/codebuddy/message-guards.ts`; `client.ts` still re-exports the public API, while the
   provider imports the leaf helper. Verified with client + transcript repair tests.
5. **`network-memory-adapters ↔ memory-provider`** — extracted `LocalMemoryProvider` into
   `src/memory/local-memory-provider.ts`; the registry still re-exports it for compatibility,
   while remote adapters depend on the leaf module. Verified with memory provider tests.
6. **`peer-rpc ↔ peer-chat-bridge`** — extracted the peer method registry/types into
   `src/server/websocket/peer-method-registry.ts`; `peer-rpc.ts` re-exports the old surface, while
   `peer-chat-bridge.ts` registers through the leaf registry. Verified with peer RPC/chat/tool tests.

The remaining 4 Phase 2 cycles are accepted in `scripts/check-circular-deps.ts` so the gate now
fails only for **new** cycles. `npm run check:circular` reports 5 accepted cycles total because the
pre-existing `agent/operating-modes ↔ agent/profiles` cycle is still intentionally accepted outside
this Phase 2 hand-off. The allowlist is intentionally exact: stale accepted entries fail the check,
so a fixed cycle cannot quietly become accepted again later. The 4 Phase 2 cycles below are still
runtime-coupled and should be broken deliberately, not hidden.

## Remaining 4 cycles (genuine value cycles → dedicated effort / hand-off)

| Cycle | Type | Note |
|---|---|---|
| `fleet-tick-handler ↔ codebuddy-agent` | value | — |
| `codebuddy-agent → agent-executor → tool-hooks → fleet-bridge → handler → agent-adapter → codebuddy-agent` | value (7 modules) | the worst; advisor: break via a hook **registry** (fleet-bridge registers via callback instead of importing) + type extraction |
| `codebuddy-agent ↔ daemon/heartbeat` | value | boot-time dependency; likely needs injected review agent factory |
| `toml-config ↔ config-mutator` | mostly type | config-mutator already `import type`s; audit suggests extracting `config-types.ts` |

These align with the audit's "multi-sprint" framing and are good candidates for the external
hand-off (Antigravity/Codex).
