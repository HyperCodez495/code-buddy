# Cowork pilotability matrix — axis-B "definition of done"

Date: 2026-05-29 (reconciled from source — see note). Source of truth:
`src/commands/slash/builtin-commands.ts` (every builtin's `prompt` token), traced
through `cowork/src/main/commands/slash-command-bridge.ts` (`resolveUiEffectAction`
switch + `COWORK_HEADLESS_ALLOW`) and `cowork/src/renderer/commands/slash-command-actions.ts`
(`PANEL_OPENERS` / `ENGINE_ACTIONS` dispatch).

**This file is the falsifiable bar for "completely pilotable from Cowork."** Every
builtin slash command has exactly one disposition. "Done" = every entry is 🟢
(pilotable) or 🔴 (deliberately CLI-only, with a true reason). 🟡 = genuine backlog
that needs a **new** Cowork surface (named) — honest "not done," not faked to 🔴.

> **Reconcile note (2026-05-29):** the prior version of this file was stale — it
> listed ~55 commands as backlog that S0–S8 + C1/C2/C3 + the routing commits had
> already routed. The mechanism: `const token = cmd.prompt` in the bridge, so a
> command whose core `prompt` is a `__TOKEN__` is pilotable the moment
> `resolveUiEffectAction` has a `case` for it (single-realm, no core change). This
> version is measured directly against the switch + allowlist + dispatch maps.

## How a command becomes pilotable
1. **ui_effect** — `resolveUiEffectAction(token)` returns an effect → dispatcher
   opens a real panel / Settings tab / runs an engine IPC op. (Most commands.)
2. **headless-allowlisted** — token in `COWORK_HEADLESS_ALLOW` → core handler runs
   read-only, output rendered as a chat message.
3. **prompt-forward** — core `prompt` is natural language → forwarded to the LLM.
4. **special-intercept** — `clear`, `memory`, `schedule` (renderer/ChatView-local).

## 🟢 Pilotable today (verified against the switch + allowlist + dispatch)

**ui_effect-routed (50 tokens):** model, switch, plan, swarm, parallel, batch,
agents, fleet, team, lessons, companion, track, config, workflow, pipeline,
plugins, plugin, permissions, policy, approvals, elevated, batch-review, security,
hooks, theme, avatar, vim, fast, dry-run, cache, prompt-cache, heal (self-healing),
search, shortcuts, persona, sessions, remember, identity, pairing, voice, speak,
tts, export, save, test, think, undo, redo, subagent, agent.

> `voice`/`speak`/`tts` (→ voice-chat overlay) and `export`/`save` (→ ExportDialog
> for the active session) route through **DOM-event bridges** (`cowork:open-voice-chat`
> / `cowork:open-export`), not store flags, because their surfaces are owned by
> Titlebar/Sidebar local state. **Verified end-to-end in real Electron** (e2e
> `slash-commands-smoke.spec.ts`), so the listener wiring is proven, not mocked.

**Already on-screen — the docked Context panel** (App.tsx renders `<ContextPanel>`
whenever a session is active): tabs **files / git / memory / knowledge / agents /
mcp** are always visible, so those domains are reachable now without a slash
command. `/add`, `/context`, `/knowledge` (browse) land here. It also renders a
**Checkpoints** section (list + restore + compare) whenever ghost snapshots exist,
so `/checkpoints`, `/restore`, `/timeline` are reachable there — and `/undo` /
`/redo` are discrete `engine_action` routes on top. Driving a *specific* tab from
a slash command would need `ContextPanel`'s local `activeTab` lifted to the store
— a minor enhancement, not a pilotability gap.

> `/security` and `/policy` route to the Permission rules tab because they are
> *config/dashboard* commands ("Show security dashboard and settings" / "Manage
> security policies"). The scan/review *action* commands (`/vulns`,
> `/secrets-scan`, `/security-review`, `/guardian`) are deliberately 🔴, not
> routed here — see below.

**headless-allowlisted (11):** help, stats, cost, tools, whoami, status, features,
history, log, workspace, diff.

**special-intercept (3):** clear, memory, schedule.

**prompt-forward:** every command whose core `prompt` is natural language (explain,
commit, refactor, docs, debug-issue, generate-tests-as-prompt, address-todo, …) —
the LLM answers in chat. These were never gated.

## 🟡 Backlog — genuine value, needs a NEW Cowork surface (honest "not done")
Each maps to a capability with real operator value but **no existing** panel/effect
to route to. Routing these is the remaining axis-B work (each = new panel/effect +
opener + test, the C3 pattern).

| Command(s) | Needs (verified against the renderer) |
|---|---|
| knowledge-graph | knowledge browse/CRUD is already on-screen (Context panel → Knowledge tab); the **graph visualization** specifically is a new view that doesn't exist yet — a genuine new feature, not a routing gap. |
| export-list, export-formats | info variants of `/export` (list destinations / formats); candidates for the headless allowlist once each core handler is confirmed read-only. |
| telemetry, quota, coverage, bug | headless allowlist — **only after** verifying each core handler is read-only (unverified = "looks done but isn't"). |

This is now a short, honest backlog. `voice`/`export` were closed with a
DOM-event bridge + e2e verification; `checkpoints`/`restore`/`timeline` turned out
to be already on-screen in the docked Context panel (see above) plus undo/redo
engine_actions. The one genuine new-view feature left is `knowledge-graph`; the
rest are headless-info candidates pending a read-only handler check. None is
environment- or security-gated.

## 🔴 Deliberately CLI-only (legitimate "done", reason = true)
- **Destructive / process:** init, reinit (workspace reset), reload (process), daily-reset, new (= Cowork sidebar new session).
- **Auth owned by the app shell:** login, logout.
- **History-dependent / covered by the engine:** compact (engine auto-compacts), btw (TUI one-shot).
- **Scan/review ACTIONS — run via the agent in chat:** review, vulns, secrets-scan, security-review, guardian (these RUN a scan/review and produce output; CodeGuardian + SecurityReview auto-delegate. Routing them to a Settings tab that does not perform the scan would be misdirection — explicitly rejected. Distinct from /security + /policy, which are config/dashboard and DO route to the rules tab.)
- **Autonomy/exec modes — no faithful slash route:** yolo (toggle full-auto), autonomy (set level suggest/confirm/auto/full/yolo). The Permission rules tab edits declarative allow/deny rules; it has no autonomy-level or YOLO control, so routing there would be a non-faithful redirect. Cowork governs autonomy via its per-session permission-mode control (the same surface `/plan` drives).
- **Covered by an existing 🟢 surface:** mode (set via /plan + model/permission controls), model-router (covered by /model auto), tool-analytics (covered by /cost + /stats), scan-todos / address-todo / replace / generate-tests / pr / conflicts (run via the agent in chat), add / context (the docked Context panel — files/git/memory/knowledge tabs), copy (native copy).
- **Git, terminal-bound:** branch, fork, branches, checkout, merge, worktree (git via the integrated terminal/agent).
- **CLI workflows / dev tooling:** ultraplan (best-of-N), dev (golden-path), tdd, ai-test, watch, lint, fix, debug, script, fcs, transform, infra, voice-code, suggest, starter, share, colab (multi-IA file convention).
- **Daemon / non-goal:** heartbeat, trigger (background daemons), cloud (remote sandbox — explicit non-goal).

## CLI groups (~40) — disposition
- 🟢 pilotable (panel/app): server/gui (app), spec, skills, lessons, user-model, cron/schedule (SettingsSchedule), provider/config (Settings), mcp (marketplace), companion, run (audit log), identity + device (C3 panels).
- 🟡 route/new-panel: secrets (vault UI — see gated note), research, flow (live launcher — see gated note), knowledge-graph, channels, groups, autonomous-code, gitnexus.
- 🔴 CLI-only: completions, update, doctor, onboard, security-audit, deploy, nodes, daemon, backup (one-off / OS / maintenance).

## Gated (axis-A autonomy + axis-B surfaces that need live resources or a security design)
Not fabricated as unverifiable code; each needs a real resource or its own review:
- **D4 — gateway inbound listener** (always-joinable agent): separate plan with its own threat-model + ExitPlanMode. Posture fixed: inbound *proposes* `needs_local_operator`, never auto-dispatches.
- **secrets vault EXECUTION**: encrypted vault + master key; security-sensitive, no reusable API surface — needs a dedicated secure design.
- **research / flow LIVE**: depend on a configured provider + network; the panel can launch them but E2E verification needs live keys.
- **browser-operator EXECUTION**: the `browser_operator` agent tool (D3) proposes a consent-gated session; the live browser run stays operator-driven behind the consent gate.

## Acceptance
Axis-B is "done" when every command is 🟢 or 🔴-with-true-reason. **Current honest
state:** the operator-cockpit-relevant surface is 🟢; the remaining 🟡 rows each need
a *new* surface (named above) and are genuine deferred backlog, not blockers hidden
as 🔴. The strong claim "100% of slash commands open a panel" is **not** true and
should not be asserted — "completely pilotable" means every command has a
**deliberate disposition**, which this matrix now provides.
