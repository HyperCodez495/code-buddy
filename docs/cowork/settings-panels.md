# Cowork Settings Panels

The Settings window (`src/renderer/components/SettingsPanel.tsx`) exposes **28 top‑level
tabs**, each rendering one panel component from `src/renderer/components/settings/`
(the `remote` tab reuses the top‑level `RemoteControlPanel`). Four further panels are
**embedded sub‑panels** surfaced inside other tabs rather than as their own tab entry —
documented at the bottom — bringing the total to **32 panel components**
(`shared.tsx` holds shared types only and is not a panel).

Tabs marked **★** are the "Start here" beginner tabs.

## Top‑level tabs (28)

| # | Tab id | Component | What it's for |
|---|--------|-----------|----------------|
| 1 | `control` ★ | `SettingsControlCenter` | Control center / launchpad: quick status and shortcuts to the Test Runner, Orchestrator, Fleet, Team and Companion panels. |
| 2 | `api` ★ | `SettingsAPI` | LLM provider configuration — API key, base URL per provider (Claude, OpenAI‑compatible, Gemini, local), OAuth sign‑in, API‑config sets/presets, and a diagnostics test run. |
| 3 | `codebuddy` | `SettingsCodeBuddy` | Code Buddy account/login (ChatGPT OAuth, plan) and core CLI‑linked settings. |
| 4 | `sandbox` ★ | `SettingsSandbox` | Sandbox isolation setup: WSL2 (Windows) / Lima (macOS) VM status and the workspace path guard. |
| 5 | `connectors` ★ | `SettingsConnectors` | MCP connector management — add/edit/enable servers (stdio/SSE/Streamable HTTP), OAuth sign‑in/out, per‑server tool list, install from presets. |
| 6 | `skills` ★ | `SettingsSkills` | Installed Agent Skills: enable/disable, version, storage path, candidate‑review queue. |
| 7 | `skillsBrowser` | `SkillsBrowser` | Browse and install skills from the hub/marketplace. |
| 8 | `customize` | `SettingsCustomize` | Theme customizer — colors, fonts, light/dark/system, UI density. |
| 9 | `projects` | `SettingsProjects` | Project CRUD and default‑project selection; scopes the session list. |
| 10 | `schedule` | `SettingsSchedule` | Scheduled‑task manager (cron‑style daily/weekly/once jobs). |
| 11 | `remote` | `RemoteControlPanel` | Remote control gateway: pair/operate the agent from **Feishu** / **Slack**, gateway port, tunnel (ngrok), pairing approvals, authorized users. |
| 12 | `logs` | `SettingsLogs` | Log viewer with filters (console + agent logs). |
| 13 | `workflows` | `SettingsWorkflows` | Visual DAG workflow editor for repeatable multi‑step runs. |
| 14 | `cost` | `SettingsCostDashboard` | Token/cost dashboard — per‑session cost trends and provider comparison. |
| 15 | `rules` | `SettingsPermissionRules` | Permission rules (allow/deny patterns), rule‑assist, dry‑run test panel. |
| 16 | `mcpMarketplace` | `SettingsMCPMarketplace` | Browse/install MCP packages from the official registry (one‑click + env guidance). |
| 17 | `snippets` | `SettingsSnippets` | Snippet library — reusable prompt/template snippets inserted into chat. |
| 18 | `customCommands` | `SettingsCustomCommands` | Define slash‑command shortcuts. |
| 19 | `workspacePresets` | `SettingsWorkspacePresets` | Save/load workspace folder presets. |
| 20 | `hooks` | `SettingsHooks` | Hooks & triggers — configure and dry‑run permission/event hooks. |
| 21 | `a2a` | `SettingsA2AAgents` | Google A2A remote‑agent task management (AgentCard discovery + task lifecycle). |
| 22 | `plugins` | `SettingsPlugins` | Plugin marketplace + installer; toggle plugin components. |
| 23 | `telemetry` | `SettingsTelemetry` | Telemetry & diagnostics — opt‑in crash reporting, OTel traces, usage stats. |
| 24 | `server` | `SettingsServer` | Embedded HTTP server config — port, JWT secret, websocket toggle. |
| 25 | `coreEngine` | `SettingsCoreEngine` | Pick the agentic loop (embedded Code Buddy engine vs `pi` fallback) + advanced engine config. |
| 26 | `profiles` | `SettingsProfiles` | Isolated config profiles (`[profiles.<name>]`) — create/switch/rename. |
| 27 | `remoteBackend` | `SettingsRemoteBackend` | Run chat/sessions on a remote Code Buddy backend instead of in‑process. |
| 28 | `general` ★ | `SettingsGeneral` | General preferences — language (EN/FR/中文), theme, font size, auto‑update; hosts Import/Export. |

## Embedded sub‑panels (4)

| Component | Surfaced in | What it's for |
|-----------|-------------|----------------|
| `SettingsLocalProviders` | `api` | Detect/configure bundled local providers (Ollama, LM Studio, vLLM) — endpoints and models. |
| `SettingsImportExport` | `general` | Import/export settings (and sessions) as JSON for backup/migration. |
| `SettingsMCPPlayground` | `connectors` / `mcpMarketplace` | Interactive MCP tool tester — invoke a connector's tools with schema‑validated input. |
| `SettingsTunnel` | `remote` | Public‑tunnel configuration (ngrok/FRP/Cloudflare) used by the remote gateway. |

> Note: `src/renderer/components/settings/shared.tsx` is not a panel — it exports the
> shared `MCPServerConfig` / `MCPServerStatus` / `MCPToolInfo` / `MCPPreset` types used
> across the connector panels.

## Tested

The **30 panel components that live in `settings/`** (the 26 tab panels rendered from
`settings/` plus the 4 embedded sub‑panels) are covered by a render smoke test,
`tests/settings-panels-smoke.test.tsx`, which mounts each with mocked i18n, store and
`window.electronAPI` and asserts it renders without throwing.

The two tabs whose component lives outside `settings/` — `remote`
(`RemoteControlPanel`) and `skillsBrowser` (`SkillsBrowser`) — are covered by their own
existing tests (`remote-control-panel-*.test.ts`, skills tests).
