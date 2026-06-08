# Code Buddy CLI reference

Detailed reference for operating `buddy`. Read the section you need.

- [Invocation & global flags](#invocation--global-flags)
- [Headless / scripting flags](#headless--scripting-flags)
- [Provider & model selection](#provider--model-selection)
- [Local Ollama models (free) — setup & the tool-calling finding](#local-ollama-models-free)
- [Command surface (grouped)](#command-surface-grouped)
- [Fleet & autonomy deep-dive](#fleet--autonomy-deep-dive)
- [The autonomy lab](#the-autonomy-lab)

## Invocation & global flags

Entrypoint resolution (first that exists): `buddy` on PATH → `./node_modules/.bin/tsx src/index.ts` (repo dev) → `node dist/index.js` (built).

| Flag | Meaning |
|---|---|
| `[message...]` | positional initial message (interactive) |
| `-p, --prompt <p>` / `--print <p>` | headless: process one prompt and exit |
| `-o, --output-format <text\|json>` | output format for headless runs |
| `-m, --model <model>` | model id (or `GROK_MODEL`) |
| `-u, --base-url <url>` | API base URL (or `GROK_BASE_URL`) |
| `--permission-mode <mode>` | `default`/`plan`/`acceptEdits`/`dontAsk`/`bypassPermissions` |
| `--yolo` | full autonomy (≈400 tool rounds, cost cap) |
| `--allowedTools` / `--disallowedTools <globs>` | restrict the tool surface |
| `--agent <name>` | run a named custom agent profile |
| `--profile <name>` | named TOML config profile |
| `--probe-tools` | probe the model for tool support; fall back to chat-only if absent |

## Headless / scripting flags

- Always pass `-p/--print` for non-interactive use; the process exits when done.
- `-o json` returns a structured result for parsing; `-o text` is human-readable.
- Headless mode auto-approves confirmations. Still set `--permission-mode`/`--allowedTools` to bound behavior.
- The exit code reflects the run result (see `src/cli/headless-options.ts: resolveHeadlessResultExitCode`).

## Provider & model selection

Detection order (first match wins): `CODEBUDDY_PROVIDER` → ChatGPT OAuth (`~/.codebuddy/codex-auth.json`) → `OLLAMA_HOST` → API keys (`GROK_API_KEY`/`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GEMINI_API_KEY`).

- **A live ChatGPT login wins over `OLLAMA_HOST`.** To use a local model regardless, set `CODEBUDDY_PROVIDER=ollama`.
- `buddy login [provider]` (default chatgpt) authenticates; `buddy whoami` shows the active identity/plan; `buddy logout` clears it.
- `buddy provider …` manages provider config; `buddy secrets …` is the encrypted key vault.

## Local Ollama models (free)

Run free, $0, on local Ollama:

```bash
CODEBUDDY_PROVIDER=ollama OLLAMA_HOST=http://localhost:11434 GROK_MODEL=<model> \
  buddy -p "<prompt>" --permission-mode acceptEdits --output-format text
```

**Tool-calling finding (verified on this project):** driving the agent to edit files needs the model to emit *structured* OpenAI tool calls.

- `qwen3*` (incl. the MoE builds, e.g. `qwen3.6:35b-a3b-q4_K_M`) emits them reliably → can autonomously edit. `model-tools.ts` marks `qwen3*` `supportsToolCalls: true`.
- `qwen2.5:7b-instruct` emits tool calls as **text** (`write_file {…}`) → not executed → effectively chat-only. Code Buddy keeps it `supportsToolCalls: false`, so it runs with a chat-only prompt and won't edit.
- Rule: **use qwen3+ for autonomous/agentic local work**; small models are fine only for chat/analysis.

`getModelToolConfig(model).supportsToolCalls` (in `src/config/model-tools.ts`) decides whether the agent gets the tool-using system prompt. An unknown model defaults to tool-capable; the Ollama families are explicitly gated. The `--probe-tools` flag additionally runs a live probe.

## Command surface (grouped)

Run `buddy <cmd> --help` for any subcommand. Most useful:

**Core / dev**
- `dev plan|run|pr|fix-ci|explain` — golden-path workflows (forces strict write policy)
- `research "<topic>"` — wide parallel research; `flow "<goal>"` — plan→execute→synthesize
- `session …` — saved sessions; `run list|show|tail|replay` — observability
- `doctor` — environment diagnostics; `onboard` — setup wizard; `config` — env config view
- `tools` — effective tool availability; `insights` — token/cost analytics (read-only)
- `update [--channel stable|beta|dev]`

**Agent surfaces**
- `mcp …` / `mcp-server` — MCP servers / run as MCP server; `acp` — run as ACP agent
- `autonomous-code` — guarded Agentic Coding Cell contract; `improve` — self-improvement loop
- `lessons` / `user-model` / `knowledge` / `todo` / `spec` — context & review-gated work
- `hermes …` — native Hermes-inspired profile/parity; `hub …` — skills marketplace; `skills …` — installed skills; `bundles …`

**Server / fleet / autonomy** (see next section)
- `server`, `fleet`, `autonomy`, `colab`, `gateway-pairing`, `heartbeat`, `daemon`, `cron`, `trigger`, `webhook`, `device`, `nodes`

**Companion / channels / voice**
- `companion …` — ChatGPT-backed voice companion; `channels …` — Telegram/Discord/Slack/…; `speak` — TTS; `pairing`/`groups` — messaging security

**Security / ops**
- `security-audit`, `execpolicy`, `approvals`, `auth-profile`, `identity`, `proxy` (OpenAI-compatible proxy), `lsp`, `git`, `gitnexus`

## Fleet & autonomy deep-dive

```bash
buddy server --port 3000              # HTTP 3000 + Gateway WS 3001 (required for the fleet)
buddy fleet status [--json]           # routing + presence
buddy autonomy run [--watch] [--interval <ms>] [--max-ticks <n>] [--dir <colab>] [--output-dir <art>]
buddy autonomy install | uninstall    # always-on systemd/launchd/Task-Scheduler service
buddy colab status                    # shared task queue (colab-tasks.json: claim lease/TTL, dependsOn DAG)
```

- The autonomous loop claims open, non-`critical` tasks in priority order, respecting DAG `dependsOn`, on the free-first model ladder (local → Tailscale network → paid). Configure via env: `CODEBUDDY_LOCAL_MODEL`, `OLLAMA_BASE_URL`, `CODEBUDDY_NETWORK_MODELS=model@url,…`, `CODEBUDDY_ESCALATION_MODEL`.
- The default daemon executor (v0) writes the model's output as a scoped artifact — it does **not** edit the repo. To make the daemon run the **real agent** (editing files), set `CODEBUDDY_AUTONOMY_EXECUTOR=agent` **and** `CODEBUDDY_AUTONOMY_WORKSPACE_ROOT=<bounded dir>` — fail-closed: it refuses to run without the workspace root, so edits stay inside that dir. The same pattern is demonstrated standalone in the autonomy lab.

## The autonomy lab

`scripts/autonomy-lab/` is a runnable, real end-to-end demo: it seeds real coding tasks onto the colab queue and drives the real `FleetAutonomousLoop` with an executor that spawns the **real `buddy` agent** headless in an isolated sandbox to edit files, gated by a self-verifying `*.check.mjs`.

```bash
tsx scripts/autonomy-lab/run.ts        # free local qwen3.6; prints a per-task pass/fail table
```

Use it as the reference pattern for "make Code Buddy work autonomously on a task set with real edits, safely (sandboxed) and free (local)."
