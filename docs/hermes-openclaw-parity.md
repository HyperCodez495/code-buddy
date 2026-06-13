# Hermes Agent & OpenClaw — parity and gaps (canonical)

**Date: 2026-06-13** (supersedes 2026-06-09) · Machine: Ministar Linux (Ryzen AI 9 HX 470, Ollama Vulkan) · Verified
against live installs: Hermes Agent `v0.16.0`, OpenClaw `2026.6.1`.

> **2026-06-13 validation pass** — real-instance/real-LLM round-trips, no metric-gaming: (1) Docker hibernate/wake
> exercised against the live daemon with independent `docker inspect` proof; (2) the OpenClaw migrator verified against
> the now-**populated** `~/.openclaw` (import 1→5, plus a real 0644→0600 secret-archive **security fix**) → promoted
> `partial`→`covered-partial`; (3) channel auto-reconnect audited across all 26 adapters (wired into the one genuinely-
> persistent gap, imessage; the rest are REST/webhook or in-process stubs — documented N/A, not force-fitted); (4) the
> Camofox runner **honestly downgraded** — real Camoufox is Firefox and does not speak Chrome CDP, so the shipped
> `--cdp-port` path does not work (prior note overclaimed); local Playwright remains the validated path; (5) agentic
> loop + tool execution + the `buddy goal` Ralph loop proven end-to-end on a real LLM (local Ollama `$0`, and gpt-5.5).

> **This is the single source of truth** for where Code Buddy stands versus Hermes Agent and OpenClaw. It supersedes the
> dated audit/status/TODO docs now under [`archive/2026-q2-hermes-audits/`](archive/2026-q2-hermes-audits/). Living
> reference docs that remain authoritative for their own topic: [`hermes-memory-providers-selfhost.md`](hermes-memory-providers-selfhost.md)
> (connector how-to), [`hermes-agent-strategy.md`](hermes-agent-strategy.md) (strategy), and the Fleet bus itself in
> [`fleet-guide.md`](fleet-guide.md).

## TL;DR

- **Vs Hermes** — the parity manifest (`src/agent/hermes-parity-manifest.ts`, surfaced by `buddy hermes parity --json`)
  reports **15 `covered` + 5 `covered-partial` + 0 `partial`, 0 `gap`** (total 20); tool parity = **65 exact + 6
  native-equivalent**. *This is the project's own self-assessment.* The 5 `covered-partial` are gated on external
  accounts, product decisions, or an ecosystem version-lock — **not on missing Code Buddy code** (table below). Each
  has been pushed as far as honestly possible with local resources this session; none was flipped to `covered` on a
  mock.
- **Vs OpenClaw** — the gateway bridge + CLI `validate-upstream` are **validated against a live OpenClaw 2026.6.1 daemon**
  (`openclaw gateway status --json`, exitCode 0, and raw WS `protocol:4` `connect.challenge` -> signed `req(connect)` ->
  `res` -> `req(status)` -> `res`). The optional live `node.pair.list` check is scope-gated by OpenClaw
  (`operator.pairing`) on this paired device. Code Buddy's AI-to-AI substrate (`peer.*` + A2A/ACP/MCP) is **richer** than
  OpenClaw's.
- **The OpenClaw migrator's two schema-drift reader bugs are now fixed** (`src/agent/hermes-claw-migrate.ts`, 2026-06-08):
  the default model (`agents.defaults.model.primary`) now **imports** and the custom-provider catalog (`models.providers`)
  is now **detected and archived 0600** — validated against the live 2026.6.1 install (import 1 / archive 5 / skip 30, was
  0 / 4 / 32). The remaining ~30 skips are **correct on this fresh/empty install** (no MCP/persona/agent-overrides/memory
  configured), not bugs; the identity/memory readers stay unverified until an install actually has that data. See
  [§4](#4-the-one-open-code-gap--openclaw-migrator-readers).

## 1. Already shipped — do not re-open

Several older docs list these as "missing" or "to wire". They are **shipped and present in source** (verified 2026-06-08).
The multi-AI comparison doc that called TTL/DAG/swarm "the honest gap" predates commits `9b605f84`/`5cebfd51`.

| Capability | Commit | Code evidence |
|---|---|---|
| Claim TTL/lease (a crashed agent's task auto-reclaims) | `9b605f84` | `src/fleet/colab-store.ts` — `isClaimExpired()` (l.200), `reclaimExpired()` (l.212), default TTL 15 min |
| DAG task dependencies on the fleet queue | `5cebfd51` | `colab-store.ts` — `dependsOn[]` (l.59), `areDependenciesMet()` (l.236), `nextClaimable()` (l.245) |
| Swarm topology (workers→verifier→synthesizer) **persisted on the board** | `5cebfd51` | `src/fleet/colab-swarm.ts` — creates colab tasks linked by `dependsOn` (not in-memory) |
| Event-driven autonomous daemon (wakes on fleet-queue change) | `70eb329b` | `FleetAutonomousDaemon` + `wake()` |
| Always-on systemd/launchd/Task-Scheduler service | `cb707a8d` | `ServiceInstaller` — `buddy autonomy install/uninstall` |
| Free-first model tier (Ollama $0 → Tailscale → paid APIs) | `884f0dc1` | `src/agent/model-tier.ts` — `chooseAutonomousModel()` |
| `/goal` + `/subgoal` Ralph loop (judge-gated auto-continue, 1:1 Hermes port) | 2026-06-11 | `src/goals/` — `applyJudgeOutcome()` decision ladder, `judgeGoal()` (fail-open, 3-strike parse auto-pause, cost-tracked), per-session store `~/.codebuddy/goals/`; turn hook in `src/hooks/use-input-handler.ts` |
| `buddy goal "<text>"` headless Ralph loop | 2026-06-11 | `src/commands/goal-cli.ts` — `runGoalLoop()` drives the full agent in-process until done/paused (exit 0/1); `--max-turns`, `--judge-model` |
| Kanban goal-mode → colab board goal-mode | 2026-06-11 | `ColabTask.goalMode/goalMaxTurns` (`src/fleet/colab-store.ts`), judge gate + block-for-human-review in `FleetAutonomousLoop.evaluateGoalModeTask()` (`src/daemon/autonomous-loop.ts`), continuation nudge in `agent-task-executor.ts`, default judge wired in `createDefaultAutonomousLoop`; CLI `buddy fleet tasks add --goal-mode` |
| Gateway goal parity → peer sessions | 2026-06-11 | `peer.chat-session.goal` (set/status/pause/resume/clear/subgoal-*) in `src/fleet/peer-session-bridge.ts`; server-side judge after `continue`/`continue-stream`, verdict + continuation prompt returned to the caller (caller-driven loop, mid-run new-goal rejected — Hermes `gateway/run.py` semantics); metadata-only `fleet:chat-session:goal` broadcasts |

> Net vs Hermes' kanban: the distinctive "shared, dependency-ordered, lease-claimed task board" combo is **now present**
> on `colab-store`. Remaining nuance is cross-machine *atomicity* — Code Buddy's JSON queue is advisory across machines
> (arbitration = `git push`), by design, vs Hermes' single-machine SQLite atomicity. That is an architectural choice, not a gap.

## 2. Gaps vs Hermes Agent — the 5 `covered-partial`

| Feature (manifest id) | Gate type | Why it isn't `covered` (2026-06-13) | Module |
|---|---|---|---|
| `messaging-gateway` | **External** (accounts) + partially unimplemented | The 26 adapter slots are not uniform: ~7 have a real persistent transport (discord/slack/telegram/whatsapp/signal/matrix + imessage), ~a dozen are functional REST/webhook adapters (dingtalk/qq/ntfy/line/teams/google-chat/…), and several for persistent protocols are still **in-process stubs whose `start()` only flips a flag** (verified: irc, mattermost, nostr, feishu, nextcloud-talk). Auto-reconnect is now wired into all 7 real-persistent adapters (imessage added this session); N/A for REST, not-yet-applicable for stubs. Live delivery still needs ~20 platform tokens. `getRegisteredCommands()` on discord+telegram. | `src/channels/*` |
| `browser-automation` | **Version-lock** (ecosystem) | Local Playwright/Chromium validated end-to-end. **Camofox does NOT work as previously claimed**: real Camoufox is Firefox (no Chrome CDP); its `camoufox server`+`firefox.connect()` path has no compatible pair against repo-pinned Playwright 1.58.2. Browser Use needs a managed gateway/key. | `src/agent/hermes-browser-backends.ts`, `src/browser-automation/camofox-runner.ts` |
| `runtime-backends` | **External** (accounts) | **Docker hibernate/wake validated for real** (running→paused→running, `docker inspect` proof). SSH not locally testable (host-key); Modal/Daytona need accounts. | `src/agent/hermes-runtime-backends.ts`, `src/agent/hermes-runtime-lifecycle.ts` |
| `mobile-supervision` | **Product** (by design) | Silent remote execution is refused on purpose; local-operator-gated. Off-device TLS packaging + client UX remain product work. | `src/server/routes/mobile.ts` |
| `openclaw-migration` | **Promoted** `partial`→`covered-partial` (see §4) | Verified against the now-populated `~/.openclaw`: 5 reader paths import real data (import 1→5), plus a real 0644→0600 secret-archive **security fix**. Stays `covered-partial` because MEMORY/MCP readers are unexercised (no such data on this install). | `src/agent/hermes-claw-migrate.ts` |

Local/free is covered wherever possible (Playwright/Chromium, Docker/WSL/SSH, Honcho/ByteRover via CLI). What pins these
at `covered-partial` is **paid accounts, a product decision, or an ecosystem version-lock** — not missing code. Flipping
any to `covered` without a real round-trip would be metric-gaming (refused). Where a local round-trip was possible this
session it was run for real (Docker, the migrator, Camoufox install, the agentic loop on a real LLM).

**Intentional product decisions** (not gaps): direct background skill writes (Code Buddy keeps review gates), RPC
code→tools in subagents (closed-by-default for security), live mobile execution, Nous Portal live OAuth. These remain
`partial`/guarded on purpose.

## 3. Gaps vs OpenClaw

Code Buddy absorbed OpenClaw patterns rather than forking it. AI-to-AI, it **exceeds** OpenClaw.

| Capability | Status | Module |
|---|---|---|
| Gateway discovery (real 2026.6.x `openclaw.json` + `devices/paired.json` layout) | **Covered / validated 2026-06-08** | `src/openclaw/gateway-bridge.ts::discoverOpenClawGateway` |
| CLI `validate-upstream` interop (`openclaw gateway status --json`, exitCode 0) | **Covered / validated** | `gateway-bridge.ts::validateOpenClawUpstreamCompatibility` |
| Raw WS `protocol:4` handshake + signed paired-device auth | **Covered / live-validated 2026-06-09** — `connect.challenge`, signed device-token connect, and `status` pass against OpenClaw 2026.6.1 | `gateway-bridge.ts` |
| Node pairing RPCs (`node.pair.list|approve|reject`) | **Covered / guarded** — current method names, safe summaries; live `node.pair.list` is blocked on this machine until OpenClaw grants `operator.pairing` | `gateway-bridge.ts` |
| Companion gateway inbox + Fleet handoff + approved reply (Telegram/Slack…) | **Covered, supervised** (local draft, never auto-dispatch) | `src/companion/gateway.ts`, `gateway-inbox.ts` |
| Per-skill `SKILL.md` Ed25519 signatures | **Covered** (2026-06-07) | `src/skills/hub-signing.ts` |
| Signed registry **index** + seeded official publisher key | **Covered** (2026-06-09) — well-known indexes verify `signature`/`indexSignature` over canonical JSON; official key is seed-read-only | `src/skills/hub-signing.ts`, `src/skills/hub.ts` |

AI-to-AI substrate Code Buddy has that OpenClaw lacks: `peer.chat` / `peer.chat-session.*` / `peer.tool.invoke` /
`peer_delegate` / `route_peer`, plus A2A + ACP + MCP. OpenClaw routes via a gateway hub (ACP, human↔agent / agent↔node);
it has **no shared peer task board**. OpenClaw "enterprise" modules (policy/hooks/compaction/retry/semantic-memory) are
**deliberately deferred** in `src/config/toml-config.ts` — they conflict with active Code Buddy systems; do not enable globally.

### Multi-AI collaboration model, at a glance
- **Hermes**: durable SQLite **kanban** shared across profiles — atomic claim+TTL, DAG `link`, swarm decompose. Agent↔agent board.
- **OpenClaw**: central **gateway hub** — isolated agents behind one gateway, routing bindings, node pairing, ACP bridge, channels. Human↔agent / agent↔node routing.
- **Code Buddy**: richer **peer.* fleet** (A2A/ACP/MCP) + `colab-store` queue **now with TTL/lease + DAG + swarm** + event-driven autonomous daemon + free-first model tier. Cross-machine arbitration via git.

## 4. OpenClaw migrator readers — promoted `partial` → `covered-partial` (2026-06-13)

> **Status (2026-06-13): PROMOTED to `covered-partial`.** The `~/.openclaw` install is now **populated** (the 2026-06-08
> audit ran against an empty one), so the identity/persona/skill readers could finally be exercised against real data.
> Live dry-run: **import 1 → 5** (the nested default model, SOUL/USER/AGENTS persona resolved from
> `agents.defaults.workspace`, and a symlinked plugin-skill). A real **security bug** was found and fixed in the process:
> the `gateway.auth.token` archive was written `0644` and is now `0600`. Regression-locked by
> `tests/agent/hermes-claw-migrate-real.test.ts` with sanitized real-shape fixtures. It stays `covered-partial` (not
> `covered`) because MEMORY/MCP/cron readers remain unexercised — this install genuinely has no such data, so writing
> those readers blind is still refused. The 2026-06-08 tables below are kept as the record of the original schema-drift fix.

**Original empirical finding (dry-run against the live `~/.openclaw`, 2026-06-08, before the fix):**
`detected: true`, but of **36 categories: 32 → `skip`, 4 → `archive`, 0 → `import`**. The migrator loads `openclaw.json`
(it is in `CONFIG_NAMES`, `hermes-claw-migrate.ts:94`). The "0 imported" splits into **two distinct causes** — verified
per-row by checking whether the source data actually exists:

Real top-level keys of `~/.openclaw/openclaw.json`: `agents`, `gateway`, `meta`, `models`, `plugins`, `session`, `tools`, `wizard`.

**(a) Proven reader bugs — 2026.6.x schema drift (source present, reader misses it):**

| Category | Migrator reads | Source IS present at | Result |
|---|---|---|---|
| model | config **root** `model`/`defaultModel`/`default_model` (l.457) | **`agents.defaults.model.primary`** = `ollama/qwen2.5:7b-instruct` | skip "No model in config" ❌ |
| custom_providers | config **root** `providers`/`customProviders`/`custom_providers` (l.519) | **`models.providers.ollama`** (`baseUrl`/`api`/`apiKey`/`models`) | skip "Not present" ❌ |

These two are real bugs: the value is configured, but 2026.6.x nests it under `models`/`agents.defaults` while the reader
only looks at the config root. (The bridge `gateway-bridge.ts` was fixed for the 2026.6.x layout in commit `6e70d612`;
the **migrator** is a separate module and was not.)

**(b) Correct skips on this fresh/empty install — NOT reader bugs (no source data exists):**

| Category | Migrator reads | Why the skip is correct here |
|---|---|---|
| mcp_servers | `mcpServers`/`mcp_servers` (l.472) | `grep -i mcp openclaw.json` is empty — no MCP server configured |
| agent_settings | `agents.defaults.timeoutSeconds`/`compaction.mode`/`approvals.*` (l.242-250) | `agents.defaults` holds only `workspace` + `model.primary` — nothing to map |
| persona / user / agents | `SOUL.md`/`USER.md`/`AGENTS.md` at home root (l.369) | `identity/*.json` are crypto device creds, not persona; no SOUL/USER content anywhere |
| memory | `MEMORY.md` at home root (l.392) | no MEMORY.md-equivalent; `state/openclaw.sqlite` is operational state (auth/diag/pairing/cron…); transcripts live in `agents/main/sessions/*.jsonl` |

> The honest gap is **narrower than "imports nothing"**: the migrator drops the configured **default model** and
> **custom provider** due to schema drift. Most other skips are an empty install behaving correctly. The identity/memory
> readers are *unverifiable as bugs here* — they would only surface if/when an install actually accumulates persona or a
> migratable memory store; their 2026.6.x shapes should be confirmed before claiming a bug.

### Fix outline
1. ✅ **DONE (2026-06-08)**: the model reader now reads `agents.defaults.model.primary` (via a new `firstStringPath`
   dotted-path helper + `CLAW_MODEL_PATHS`), and the `custom_providers` archive spec now detects the nested
   `models.providers` (new optional `paths` on `ArchiveCategorySpec`, dotted-path-aware matcher + `sliceForArchive`,
   marked sensitive → 0600). `model` → **import**, `custom_providers` → **archive** (not import — the shape differs from
   Code Buddy's provider config and the block carries an apiKey). Legacy `clawdbot`/`moltbot` root keys kept as fallback.
2. ✅ Regression-locked: `tests/agent/hermes-claw-migrate-real.test.ts` (legacy `clawdbot.json` asserts `settings.model ===
   'claude-sonnet-4-6'`; new 2026.6.x `openclaw.json` asserts model→import of `ollama/qwen2.5:7b-instruct` + custom_providers
   archived 0600 from `models.providers`).
3. **Still pending source data**: only when an install actually has them, verify and add 2026.6.x readers for MCP,
   agent-behavior overrides, identity and a migratable memory store — don't add them blind.
4. **Manifest status kept `partial` (deliberately).** Two readers fixed against one near-empty install is *not* "the
   migrator works against real installs." The note (`hermes-parity-manifest.ts`) now says model+provider readers are
   fixed and live-validated, with identity/memory/mcp/agent-settings still unverified for lack of source data. Flip to
   `covered-partial` only after a populated install exercises the rest.
- Files: `src/agent/hermes-claw-migrate.ts` (readers), `src/agent/hermes-parity-manifest.ts` (note),
  `tests/agent/hermes-claw-migrate-real.test.ts` (2026.6.x fixture).

## 5. Verification

```bash
# Hermes parity (counts come from the manifest itself)
npx tsx src/index.ts hermes parity --json            # expect 15 covered-partial / 5 partial / 0 gap

# Already-shipped fleet primitives (sanity — these are NOT gaps)
grep -nE "isClaimExpired|areDependenciesMet|nextClaimable" src/fleet/colab-store.ts

# OpenClaw bridge interop against the live 2026.6.1 daemon
npx tsx src/index.ts hermes claw bridge validate-upstream --openclaw-bin "$(command -v openclaw)"

# The migrator gap — reproduces 0 imports against the real install
npx tsx src/index.ts hermes claw status --json | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print('imported:', sum(1 for e in d['entries'] if e['action']=='import'), '/', len(d['entries']))"
```
