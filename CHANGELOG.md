# Changelog

All notable changes to Code Buddy are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it reaches `1.0.0`.

---

## [Unreleased]

Approaching `1.0.0-rc.1` — see the v1-readiness plan in `.claude/plans/`.
Pending work tracked in [`docs/fleet-guide.md`](docs/fleet-guide.md) and
the audit follow-ups noted under `## [0.5.1-fleet]`.

### Backlog (not yet shipped)

- **Streaming `peer.chat-stream`** (V1.1) — current `peer.chat` is one-shot
  request/response. Streaming will let consumers see tokens as they arrive.
- **Multi-tour `peer.chat-session`** (V1.2) — `start` / `continue` / `end`
  for stateful conversations between peers.
- **Rate cap `peer.chat`** ((d).16b) — deferred until burn-rate problems
  observed live; the Gemini Ultra quota (~50M tokens/month) is generous
  enough to test without one for now.
- **Audit Gemini CLI source / Codex source** — applies the same
  comparative-audit pattern (used for Claude Code source) to other
  open-sourced agent runtimes.
- **Live smoke tests** for `peer.chat` with real provider keys (manual
  validation by the operator after each release).

---

## [0.5.1-fleet] — 2026-05-04

The fleet inter-Claude shipped its first **business method**: peers
can now ask each other's LLM a one-shot question via
`/fleet send <peer> peer.chat`. Plus two follow-up fixes derived from
a comparative audit against Claude Code source code (publicly released
~one month ago, ~50,000 GitHub forks).

### Added

- **Peer RPC routing — Phase (d).15** (`4876142`):
  - `peer:request` / `peer:response` WS frames with id-correlation map
  - Built-in methods registered at boot: `peer.describe`, `peer.ping`,
    `peer.echo`
  - `FleetListener.request(method, params, options?)` API with
    REQUEST_TIMEOUT (default 30s), AUTH_FAILED, NOT_OPEN, DISCONNECTED
    error codes
  - New `peer:invoke` ApiScope (paired with the existing `fleet:listen`)
- **Env-driven multi-provider peer.chat client wiring — Phase (d).16a**
  (`568ceda`):
  - `createPeerChatClientFromEnv()` factory auto-detects which provider
    keys are present at server boot, in priority order:
    `CODEBUDDY_PEER_PROVIDER` override → `OLLAMA_HOST` → `GROK_API_KEY`
    → `ANTHROPIC_API_KEY` → `GOOGLE_API_KEY`/`GEMINI_API_KEY` →
    `OPENAI_API_KEY`. Local first to spare cloud quotas.
  - `wirePeerChatBridge()` now accepts a `providerInfo` second arg,
    surfaced via `peer.describe.peerChatProvider` so remote Claudes can
    discover which LLM lives behind a given peer.
  - `apiVersion` bumped from `d.15` to `d.16` in `peer.describe`.
- **Adaptive auto-compact threshold helper** (post-audit fix #1,
  `09d47d7`):
  - New `src/context/auto-compact-threshold.ts`. Pure module exposing
    `computeAutoCompactThreshold(maxContextTokens, model?, options?)`
    and `pickBufferTokens(model, options?)`.
  - Per-model buffer table (Claude Opus 16K, Sonnet 13K, Haiku 8K,
    Gemini Pro 13K, Flash 10K, Grok-3 12K, Grok-4 14K, etc.) with
    case-insensitive substring matching.
  - Resolution priority: explicit `bufferTokens` > per-call
    `bufferTokensByModel` > env `CODEBUDDY_AUTOCOMPACT_BUFFER_TOKENS`
    > default table > fallback.
  - Helper not yet wired into `ContextManagerV2.shouldAutoCompact`
    (deferred to V1.3 to stay narrow).

### Fixed

- **Tool pair preservation in truncation** (post-audit fix #3,
  `c05b5ea`): when `SmartCompactionEngine.truncateMessages` cuts the
  conversation between an assistant `tool_use` and its matching
  `tool_result`, downstream `validateToolCallOrder()` would silently
  strip the orphan. New pure helper `preserveToolPairs(kept, original)`
  re-injects the missing parent in original-order position. Pair
  integrity > strict budget compliance.

### Changed

- `peer.describe` payload now includes `peerChatProvider`
  (`{ provider, model, isLocal } | null`) so consumers can probe which
  LLM/model a peer will use before sending `peer.chat`.

### Tests

- 11 new tests for `peer-chat-bridge` ((d).15)
- 18 new tests for `peer-chat-client-factory` ((d).16a)
- 12 new tests for `tool-pair-preserver` (audit fix #3)
- 33 new tests for `auto-compact-threshold` (audit fix #1)

Total **874+ tests across `tests/server/` + `tests/gateway/` +
`tests/fleet/` + `tests/context/`**. Typecheck clean. Lint clean on
all touched files.

### Source audit

The comparative audit Claude Code source vs Code Buddy
SmartCompactionEngine is archived in
[`claude-et-patrice/propositions/AUDIT-COMPACTION-CLAUDE-CODE-2026-05-04.md`](https://github.com/phuetz/claude-et-patrice).
3 actionable improvements identified — #3 and #1 shipped, #2 (preview
mode before apply, M scope) deferred to `1.0.0` final.

---

## [0.5.0-fleet-infrastructure] — 2026-05-03

The day the inter-Claude fleet became real. 16 narrow phases shipped
in a single working day, plus 5 critical-priority test files. The
hardware setup (DARKSTAR PC 3090, MINISTAR G7 PT, Ministar Linux Ryzen
AI 9 HX 470) and Tailscale mesh (`100.x.x.x` private network) became
the first operational multi-AI hub on the lab.

### Added — Fleet inter-Claude (Phases (d).1 → (d).14)

- **Phase (d).1** (`d108d9b`): Server-side `fleet:*` event broadcast
  surface gated on the new `fleet:listen` ApiScope. WS plumbing only.
- **Phase (d).2** (`1fa6798`): `agent-executor` broadcasts tool exec
  events (`tool_started`, `tool_completed`, `tool_error`) to the fleet.
- **Phase (d).3** (`8632314`): `MultiAgentSystem` broadcasts workflow
  lifecycle events (`start`, `event`, `complete`).
- **Phase (d).4** (`1ff86f7`): Subagent session events (`spawn`,
  `message`) added to the fleet bus.
- **Phase (d).5** (`fa7432c`): Receiver side. `FleetListener` client +
  `/fleet listen` slash command.
- **Phase (d).6** (`98664d8`): `FleetListener` auto-reconnect with
  exponential backoff via the shared `ReconnectionManager`.
- **Phase (d).7** (`783157f`): Server-side broadcast backpressure with
  drop-on-overflow. Per-client `bufferedAmount` ceiling.
- **Phase (d).8** (`263dcf1`): Mirror of (d).7 for the Gateway WS
  surface (`src/gateway/ws-transport.ts`).
- **Phase (d).9** (`24f3031`): Peer presence beacon — periodic
  `fleet:peer:heartbeat` + `lastSeen` tracker + `⚠ stale` flag in
  `/fleet status`.
- **Phase (d).10** (`9b623b1`): Compaction lifecycle notices —
  `fleet:peer:compacting:start` / `:complete` bridged from
  `SmartCompactionEngine` events.
- **Phase (d).11** (`acc918a`): In-memory event history ring +
  `/fleet history [N] [--peer <name>]` slash.
- **Phase (d).12** (`f2a7a5a`): Multi-peer fan-in. `/fleet listen` can
  now hold N concurrent peers via a `Map<peerId, ActiveListener>`.
  Replaces the V0.4.1 single-peer singleton. New `--name <id>` arg.
- **Phase (d).13** (`6ede944`): Peer RPC routing. `/fleet send <peer>
  <method>` for active request/response between peers (mirror of
  OpenClaw's `node.invoke`, audited 2026-05-04).
- **Phase (d).14** (`9ca5b7e`): Role taxonomy + spawn depth cap +
  trace propagation. `CODEBUDDY_PEER_ROLE=main|orchestrator|leaf`,
  `CODEBUDDY_PEER_MAX_DEPTH` (default 3), `traceId` propagation
  end-to-end. Closes recursive-spawn risk.

### Added — Test plan T1-T5 (CRITIQUE coverage)

Audit-driven test plan, 5 zones identified as critical-without-coverage:

- **T1 — `permission-modes.ts`** (`9e9cd8f`): 38 tests, **100%
  coverage** all axes (statements / branches / funcs / lines).
- **T2 — `agent-context-facade.ts`** (`f9daa2b`, re-cadré ex-T3): 27
  tests, 100% lines, 91% branches. Lazy-init contract validated.
- **T3 — `model-routing-facade.ts`** (`88e4ea0`): 39 tests, 100% all
  axes. resolveModelForIntent priority cascade fully exercised.
- **T4 — `prompt-builder.ts`** (`a80d0ef`): 22 tests, 93% lines.
  Truncation budget guard validated incl. 32K hard cap edge.
- **T5 — `infrastructure-facade.ts`** (`3f4a224`): 17 tests, 96% lines.
  initializeMCP fire-and-forget paths covered.

Note on T2 re-cadrage: the original test plan T2 was `write-policy.ts`,
but it was already at 100% coverage with 19 existing tests (audit false
negative). Promoted T3 to T2 and shifted the rest.

### Source audits (2026-05-03)

Two comparative audits informed the design choices:

- **OpenClaw `v2026.3.14` → `v2026.5.2`** (general-purpose agent,
  ~25k tokens): identified 3 alignement bricks for inter-AI harmony —
  presence beacon (mirrored in (d).9), compaction notices (mirrored
  in (d).10), role taxonomy (mirrored in (d).14).
- **OpenClaw `node.*` RPC pattern** (Explore agent, ~15k tokens):
  request/response correlation map, `node.invoke` envelope, capabilities
  discovery — all mirrored in (d).13.

---

## [0.5.0] — 2026-04-27 to 2026-05-02

Multi-agent V0.3 → V0.4.1 phases + A2A protocol POC + Ollama spoke
infrastructure. Set the stage for the fleet inter-Claude work that
followed.

### Added — Multi-agent V0.3 → V0.4.1

- **Phase H+I+J+K (V0.3)**: Sessions wake-up, ConfirmationService gates,
  per-task checkpoint resume, persistent workflow state.
- **Phase L (V0.4)** (`647ba58`): Cost tracking + budget cap with
  graceful workflow interrupt.
- **Phase M (V0.4.1)** (`9ae6a65`): Conflict auto-resolve, narrow
  scope (`prefer-reviewer` / `code_overlap`), losing tasks blocked.
- **Phase N (V0.4.1)** (`62c31ef`): Adaptive allocation cross-session
  persistence (`~/.codebuddy/agents/metrics.json` schema v0.4).
- **Phase O (V0.4.1)** (`3bfe829`): `WorkflowOrchestrator` for
  concurrent + queued workflows.

### Added — A2A protocol POC (Niveau 1 → 3)

- POC Niveau 1: Spoke registration via `POST /api/a2a/agents/register`
  + heartbeat. Hub at Ministar Linux `100.98.18.76:3000`.
- POC Niveau 2 (`6bf7349`): Cross-host task router forwarding to remote
  spokes via HTTP.
- POC Niveau 3 (`677a146`): Skill-based routing dispatch on
  `/tasks/send`. Smart skill selection (`074fd3d`).

### Added — Ollama spoke infrastructure

- `world-model/scripts/ollama_a2a_spoke.py` (Python wrapper, ~150 LOC):
  transforms a local Ollama instance into an A2A-compliant spoke that
  registers with the hub and answers task forwards.
- Defensive fixes: cross-platform hostname, `--name`/`--url` overrides,
  nested A2A text payload extraction.

### Added — OpenClaw alignment audit (waves 1-4)

7 phases per wave, each ~3-5 commits, importing the most relevant
patterns from OpenClaw `v2026.3.x` releases — context engine pluggable,
ACPX sessions, browser batch + profiles, Slack Block Kit, Gateway TLS
skip, backup CLI, Docker timezone, env blocklist, transcript repair,
cron session binding, gateway health monitor, plugin describeMessageTool,
Feishu cards + reasoning, output sanitizer, gateway WS origin
hardening (GHSA-5wcw-8jjv-m286), image content pruning, provider
plugin onboarding, `config set` command, per-agent params,
`doctor --fix`, `CODEBUDDY_CLI` env, `update --tag`, `/btw` slash,
`sessions_yield`, Firecrawl, pluggable sandbox backends, extension
relay removal, provider-bundled plugins, `imageGenerationModel`
config, `/plugin` singular, multiple security fixes.

---

## [0.4.x] — 2026-mars

Pre-fleet era. ~1,300 commits worth of refactor work, Cowork desktop
GUI integration, RTK Windows fix, ICM bridge wiring, security audits
(2026-03-07, 2026-03-10, 2026-03-11), 60+ test files fixed. Audit
OpenClaw initial waves identified the path that led to 0.5.0.

Highlights:

- Code Buddy V4 status (V4.1 + V4.3 + V4.4 livrées, V4.2/V4.5+ déférés)
- Heartbeat tick (`tools/heartbeat_tick.py`) for autonomous fleet
- DailyReset reactivation
- 8 built-in agents: PDF, Excel, DataAnalysis, SQL, Archive,
  CodeGuardian, SecurityReview, SWE
- Multi-agent system foundations

The full pre-0.5 history is preserved in git log; this CHANGELOG
starts the structured record at 0.5.0.

---

## Notes for fleet Claudes

When pulling this branch on DARKSTAR / MINISTAR / Ministar Linux:

1. `git pull --rebase` to get the latest fleet phases + post-audit fixes
2. Restart your `codebuddy-a2a.service` (or equivalent) to pick up
   the new server-side handlers (peer-rpc, peer-chat-bridge,
   compaction-bridge, heartbeat-broadcaster)
3. Check the new env vars in `docs/fleet-guide.md` (if you want to
   activate `peer.chat` as a real LLM endpoint, set
   `GOOGLE_API_KEY` / `GROK_API_KEY` / `ANTHROPIC_API_KEY` /
   `OPENAI_API_KEY` or `OLLAMA_HOST`)
4. Smoke test cross-host: from one peer,
   `/fleet listen ws://<other-host>:3000/ws --auto-reconnect --api-key $K`
   then `/fleet send (default) peer.describe` should return the other
   peer's hostname + provider info.

Fleet is the major V1-defining feature. All other infrastructure is
mature and stable.
