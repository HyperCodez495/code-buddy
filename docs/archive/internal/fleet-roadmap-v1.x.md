# Fleet — V1.x Roadmap

The Fleet (multi-AI hub) is the headline V1 feature, but what is *shipped* vs.
*deferred* has been scattered across `CHANGELOG.md`, code comments, and the phase
sections of [`fleet-guide.md`](./fleet-guide.md). This table consolidates it so
collaborators and users know what to expect.

Canonical sources: [`fleet-guide.md`](./fleet-guide.md) (usage),
[`hermes-openclaw-parity.md`](./hermes-openclaw-parity.md) (parity), and the
`src/fleet/` modules wired in `src/server/index.ts`.

## Shipped in V1.0

| Capability | Method / surface | Module |
|---|---|---|
| One-shot peer LLM call | `peer.chat` | `peer-chat-bridge.ts` |
| Streaming peer chat | `peer.chat-stream` | `peer-chat-bridge.ts` |
| Multi-turn sessions (FIFO, idle-TTL, persisted) | `peer.chat-session.start\|continue\|end\|continue-stream\|list` | `peer-session-bridge.ts`, `peer-session-store.ts` |
| Remote **read-only** tool exec | `peer.tool.invoke` + `.stream` | `peer-tool-bridge.ts` |
| LLM-driven routing | `route_peer` tool, `/fleet route` | `task-router.ts`, `privacy-lint.ts` |
| Autonomous fleet daemon (lease TTL, DAG) | colab store + tick broadcaster | `colab-store.ts` |

`peer.tool.invoke` security is gated, in order: allowlist
(`CODEBUDDY_PEER_TOOL_ALLOWLIST`, default `view_file`/`list_directory`/`search`)
→ registry `fleetSafe: true` flag → workspace root
(`CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT`, **fails closed** when unset). Anti-loop:
`CODEBUDDY_PEER_MAX_DEPTH`, `CODEBUDDY_PEER_ROLE=leaf`.

## Deferred to V1.x

| Feature | Why deferred | Notes / when |
|---|---|---|
| **Mutating tools over `peer.tool.invoke`** (Edit/Write/Bash) | Security-sensitive: remote file edits need a two-phase commit (remote proposes a diff → local operator approves the diff → execute) + audit log. Not safe to ship without that bridge. | Highest-value fleet differentiator. Needs a new approval flow + E2E loopback test in `tests/fleet/`. |
| **Per-method JWT scopes** (e.g. `peer:chat:invoke`, `peer:tool:invoke`) | Today a `peer:invoke` grant lets the caller use *any* registered method. Sub-scoping needs a permission model change. | Required before multi-tenant / enterprise fleet. |
| **Per-peer rate cap** | Intentionally deferred "until burn-rate problems observed live" — avoid premature limits. | Add when real burn-rate issues appear. |
| **Audit logging of every `peer.invoke`** | Currently best-effort `logger.info`; no centralized compliance sink. | Needed for compliance deployments. |
| **Multi-workspace peer tool isolation** | `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` is a singleton; a peer with several projects can't scope a request to one. | After mutating-tools approval lands. |
| **Cross-workspace cancellation** | No cancellation propagation across workspaces. | With multi-workspace. |
| **MCP-tool exposure over fleet** | MCP tools are not exposed via `peer.tool.invoke`. | After the security model is sub-scoped. |

## Guiding principle

Fleet ships **fail-closed**: a capability is exposed only once its security gate
is in place. The deferred items above are deferred *because* their gate isn't
built yet — not because of effort. Don't relax a gate to unblock a feature; build
the gate first.
