# Commands

## Slash Commands (In-Chat)

### Session and Model

| Command | Description |
|:--------|:------------|
| `/help` | Show help |
| `/model [name]` | Change model |
| `/switch <model\|auto>` | Mid-conversation model switching |
| `/profile [id]` | Switch connection profile |
| `/mode [mode]` | Change security mode (`suggest`, `auto-edit`, `full-auto`) |
| `/cost` | Show cost dashboard |
| `/compact [level]` | Compress conversation context |
| `/config [key] [value]` | View/set configuration |
| `/config set <key> <value>` | Set config value (dot-notation) |

### Reasoning

| Command | Description |
|:--------|:------------|
| `/think off\|shallow\|medium\|deep\|exhaustive` | Set reasoning depth |
| `/think status` | Show reasoning config and last result |
| `/think <problem>` | Run Tree-of-Thought on a problem |
| `/megathink` | Deep reasoning (10K tokens) |
| `/ultrathink` | Exhaustive reasoning (32K tokens) |

### Development

| Command | Description |
|:--------|:------------|
| `/pr [title] [--draft]` | Create GitHub/GitLab PR from current branch |
| `/lint [run\|fix\|detect]` | Auto-detect and run project linters (eslint, ruff, clippy, golangci-lint, rubocop, phpstan) |
| `/bug [severity]` | Run bug finder with optional severity filter |
| `/conflicts` | Resolve Git merge conflicts |
| `/replace` | Codebase-wide find and replace |
| `/watch start\|stop\|status` | File watcher trigger |
| `/vulns` | Dependency vulnerability scanner |
| `/coverage` | Coverage target configuration |
| `/transform modernize\|typescript\|async\|functional\|es-modules` | Code transformation |
| `/suggest` | Proactive suggestions by category |

### Agents and Orchestration

| Command | Description |
|:--------|:------------|
| `/batch <instruction>` | Decompose goal into parallel units, spawn agents |
| `/team start\|add\|status\|stop\|task\|send\|inbox` | Agent Teams coordination |
| `/btw <question>` | Side question without tools or history modification |

### Memory and Knowledge

| Command | Description |
|:--------|:------------|
| `/memory` | Memory management |
| `/lessons list\|add\|search\|graph\|stats` | Lessons management |
| `/tools [list\|info]` | List available tools |

### Voice

| Command | Description |
|:--------|:------------|
| `/speak <text>` | Speak text with current TTS provider |
| `/tts on\|off\|auto` | TTS control |
| `/tts provider <name>` | Switch TTS provider |
| `/tts voice <voice>` | Set voice |
| `/voice-code` | Voice-to-code pipeline |

### Autonomy

| Command | Description |
|:--------|:------------|
| `/yolo on\|off\|safe\|status` | YOLO mode control |
| `/yolo allow "<cmd>"` | Add command to auto-execute list |
| `/yolo deny "<cmd>"` | Block a command pattern |
| `/autonomy suggest\|confirm\|auto\|full\|yolo` | Autonomy level |
| `/send on\|off\|inherit` | Message send policy override |

### Other

| Command | Description |
|:--------|:------------|
| `/persona list\|use\|info\|reset` | Manage AI personas |
| `/plugin <action>` | Owner-gated plugin management (local terminal only) |
| `/quota` | Rate limit / quota display per provider |
| `/telemetry on\|off\|errors-only` | Telemetry toggle |
| `/secrets-scan` | Run secrets detector |

## CLI Subcommands

### Dev Workflows

```bash
buddy dev plan "<objective>"       # Profile repo + produce task plan
buddy dev run "<objective>"        # Plan + implement + test + artifacts
buddy dev pr "<objective>"         # Dev run + generate PR summary
buddy dev fix-ci [--log <file>]    # Read CI logs + propose patch
buddy dev issue <url-or-number>    # GitHub issue -> branch -> code -> tests -> PR
buddy dev explain                  # Summarize repo conventions
```

### Daemon and Background

```bash
buddy daemon start [--detach] [--install-daemon] [--foreground]
buddy daemon stop | restart | status | logs [--lines N]
buddy heartbeat start | stop | status | tick
buddy trigger list | add | remove
```

### Research and Orchestration

```bash
buddy research "<topic>" [--workers N] [--rounds N] [--output file.md]
buddy flow "<goal>" [--max-retries N] [--verbose]
```

### Knowledge and Memory

```bash
buddy knowledge list | show | search | add | remove | context
buddy lessons list | add | search | graph [--concept concept] [--no-keywords] [--json|--markdown|--mermaid] [--graph-output file] [--vault dir] | stats | clear | context
buddy todo list | add | done | update | remove | clear-done | context
```

`buddy lessons graph --graph-output` infers `json`, `markdown`, or
`mermaid` output from `.json`, `.md`, `.mmd`, or `.mermaid` extensions
when no explicit format flag is provided.
`--vault <dir>` writes an Obsidian-style folder with `index.md`,
`_concepts.md`, `_lessons.md`, `concepts/*.md`, `lessons/*.md`,
`graph.json`, `graph.mmd`, and `manifest.json`.
Vault pages include YAML frontmatter so Obsidian/plugins and future
Code Buddy UI surfaces can read page type, concepts, backlinks, and
graph metadata without reparsing prose.
`manifest.json` lists stable entrypoints and generated files for UI
loading, plus concept-to-file and lesson-to-file maps.

### Infrastructure

```bash
buddy server --port 3000
buddy hub search | install | uninstall | update | list | info | publish | sync
buddy mcp add <server> | list
buddy identity show | get | set | prompt
buddy nodes list | pair | approve | describe | remove | invoke | pending
buddy pairing status | list | pending | approve <code> | add <id> | revoke <id>
buddy groups status | list | block | unblock
buddy auth-profile list | add | remove | reset
buddy config show | validate | get
```

### Security

```bash
buddy security-audit [--deep] [--fix] [--json]
buddy secrets list | set | get | remove | rotate | audit | import-env
buddy approvals list | approve | deny | policy
buddy execpolicy check | check-argv | add-prefix | dashboard
```

### Deployment and Updates

```bash
buddy deploy platforms | init | nix
buddy update [--channel stable|beta|dev] [--check] [--force] [--tag <ref>]
buddy backup create | verify | list | restore [--only-config] [--no-include-workspace]
```

### Setup

```bash
buddy onboard          # Interactive setup wizard
buddy doctor [--fix]   # Environment diagnostics (--fix for auto-migration)
buddy speak [text] [--voice <name>] [--list-voices] [--speed <n>]
```

### Observability

```bash
buddy run list                      # List recent runs (most recent first, 30-run prune)
buddy run show <run-id>             # Show full event log for a run
buddy run tail [--follow]           # Tail the active run; --follow streams as it grows
buddy run replay <run-id>           # Replay a run's tool events for debugging
```

Runs are persisted as JSONL in `.codebuddy/runs/`. Each run captures
the message thread, tool calls, results, errors, and timing. Combine
with `OTEL_EXPORTER_OTLP_ENDPOINT` for remote traces or `SENTRY_DSN`
for error reporting (see `docs/configuration.md`).

## Global CLI Flags

| Flag | Short | Description | Default |
|:-----|:------|:------------|:--------|
| `--version` | `-V` | Show version | - |
| `--directory <dir>` | `-d` | Set working directory | `.` |
| `--api-key <key>` | `-k` | API key | - |
| `--base-url <url>` | `-u` | API base URL | - |
| `--model <model>` | `-m` | AI model | auto-detect |
| `--prompt <prompt>` | `-p` | Single prompt (headless mode) | - |
| `--profile <name>` | | Named config profile | - |
| `--max-tool-rounds <n>` | | Max tool execution rounds | 400 |
| `--max-price <dollars>` | | Session cost limit | $10 |
| `--security-mode <mode>` | `-s` | `suggest`, `auto-edit`, or `full-auto` | `suggest` |
| `--permission-mode <mode>` | | `default`, `plan`, `acceptEdits`, `dontAsk`, `bypassPermissions` | `default` |
| `--output-format <fmt>` | `-o` | `json`, `stream-json`, `text`, `markdown` | `json` |
| `--context <patterns>` | `-c` | Glob patterns to load into context | - |
| `--continue` | | Resume most recent session | - |
| `--resume <id>` | | Resume specific session | - |
| `--auto-approve` | | Auto-approve all tool executions | false |
| `--dangerously-skip-permissions` | | Bypass permission checks (CI only) | false |
| `--yolo` | | Full autonomy mode | false |
| `--disallowed-tools <list>` | | Comma-separated tool blacklist | - |
| `--system-prompt <id>` | | `default`, `minimal`, `secure`, `architect`, or custom | `default` |
| `--vim` | | Vim keybindings | false |
| `--plain` | | Minimal formatting | false |
| `--no-color` | | Disable colors | false |
| `--browser` | `-b` | Launch browser UI | false |
| `--channel <name>` | | Start with a messaging channel | - |
