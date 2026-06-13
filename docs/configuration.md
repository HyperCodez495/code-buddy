# Configuration

## Environment Variables

### Required

| Variable | Description |
|:---------|:------------|
| `GROK_API_KEY` | xAI API key (default provider) |

### Provider Keys

| Variable | Provider |
|:---------|:---------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT) |
| `GOOGLE_API_KEY` | Google (Gemini) |
| `MISTRAL_API_KEY` | Mistral AI |
| `GROQ_API_KEY` | Groq |
| `TOGETHER_API_KEY` | Together AI |
| `FIREWORKS_API_KEY` | Fireworks AI |
| `OPENROUTER_API_KEY` | OpenRouter |
| `NOVITA_API_KEY` | NovitaAI |
| `GLM_API_KEY` / `ZAI_API_KEY` | z.ai / GLM |
| `KIMI_API_KEY` / `MOONSHOT_API_KEY` | Kimi / Moonshot |
| `MINIMAX_API_KEY` | MiniMax |
| `DASHSCOPE_API_KEY` | Alibaba / DashScope |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `HF_TOKEN` | Hugging Face router |
| `NVIDIA_API_KEY` | NVIDIA NIM |
| `STEPFUN_API_KEY` | StepFun |
| `GITHUB_COPILOT_TOKEN` / `COPILOT_GITHUB_TOKEN` | GitHub Copilot |
| `OLLAMA_HOST` | Ollama (default: localhost:11434) |
| `VLLM_BASE_URL` | vLLM server URL |
| `AWS_BEDROCK_REGION` / `AWS_REGION` | AWS Bedrock region |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS Bedrock credentials |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint |
| `AZURE_OPENAI_API_KEY` / `AZURE_OPENAI_AD_TOKEN` | Azure OpenAI credentials |

### Search and Tools

| Variable | Description |
|:---------|:------------|
| `BRAVE_API_KEY` | Brave Search API |
| `EXA_API_KEY` | Exa neural search |
| `PERPLEXITY_API_KEY` | Perplexity AI search |
| `SERPER_API_KEY` | Google Search via Serper |
| `FIRECRAWL_API_KEY` | Firecrawl search/scrape tools |
| `MORPH_API_KEY` | Fast file editing |
| `PICOVOICE_ACCESS_KEY` | Porcupine wake word detection |

### Channels

| Variable | Description |
|:---------|:------------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `DISCORD_TOKEN` | Discord bot token |
| `SLACK_BOT_TOKEN` | Slack bot token |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | Feishu/Lark app credentials |

### Runtime

| Variable | Description | Default |
|:---------|:------------|:--------|
| `GROK_BASE_URL` | Custom API endpoint | - |
| `GROK_MODEL` | Default model | - |
| `CODEBUDDY_MAX_TOKENS` | Override response token limit | model's maxOutputTokens |
| `MAX_COST` | Session cost limit ($) | $10 (YOLO: $100) |
| `YOLO_MODE` | Full autonomy mode | false |
| `JWT_SECRET` | API server auth | Required in production |
| `CODEBUDDY_AUTOCOMPACT_PCT` | Auto-compact threshold (% of context window) | - |
| `CODEBUDDY_RTK` | Enable RTK shell command rewriting | false |
| `CODEBUDDY_RTK_REWRITE` | Alias flag for RTK shell command rewriting | false |
| `CODEBUDDY_RTK_TIMEOUT_MS` | Timeout for `rtk rewrite` before fallback | 1000 |
| `CODEBUDDY_FALLBACK_PROVIDERS` | Comma-separated provider/model fallbacks, for example `openai:gpt-4o,glm:glm-5-code` | unset |
| `CODEBUDDY_FALLBACK_PROVIDER` / `CODEBUDDY_FALLBACK_MODEL` | Single provider/model fallback pair | unset |
| `OPENROUTER_PROVIDER_*` | OpenRouter provider routing options | unset |
| `CODEBUDDY_AUXILIARY_<TASK>_*` | Hermes-style auxiliary provider/model/base URL/API key/timeout overrides | unset |
| `AUXILIARY_VISION_MODEL` | Hermes-compatible vision model override | unset |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | HTTP proxy support | - |

### Persistent Memory

Code Buddy's markdown memory is bounded like Hermes: project memory defaults to
2,200 chars and user/profile memory defaults to 1,375 chars. Writes that would
overflow return an error so the agent can consolidate or remove entries before
retrying.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `CODEBUDDY_MEMORY_ENFORCE_LIMITS` | Reject writes over the char budget | true |
| `CODEBUDDY_MEMORY_PROJECT_CHAR_LIMIT` | Project memory budget | 2200 |
| `CODEBUDDY_MEMORY_USER_CHAR_LIMIT` | User/profile memory budget | 1375 |
| `CODEBUDDY_MEMORY_SECURITY_SCAN` | Block prompt-injection, credential-exfiltration, private-key, and invisible-Unicode memory writes | true |
| `CODEBUDDY_MEMORY_REJECT_DUPLICATES` | Treat exact duplicate memory writes as successful no-ops | true |
| `CODEBUDDY_MEMORY_AUTO_PROPOSE` | Enqueue review-gated long-term memory candidates at session end | true |

Session-end auto-memory never writes accepted memory directly. It stores
pending candidates in `.codebuddy/memory-candidates.json`; approve them with
`/memory accept <id>` after review.

### Debugging

| Variable | Description | Default |
|:---------|:------------|:--------|
| `CACHE_TRACE` | Debug prompt construction | false |
| `PERF_TIMING` | Startup phase profiling | false |
| `VERBOSE` | Verbose output | false |
| `SENTRY_DSN` | Sentry error reporting | - |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry OTLP endpoint | - |
| `LOG_MAX_SIZE` | Max log file size | 10MB |
| `LOG_MAX_FILES` | Max rotated log files | 5 |

## TOML Config

Main config file: `.codebuddy/config.toml`

```toml
[model_pairs]
architect = "claude-sonnet-4"
editor = "grok-code-fast-1"

[agent_defaults]
imageGenerationModel = "dall-e-3"

[agent_defaults.agents.sql]
temperature = 0.2
maxTokens = 4096

[integrations]
rtk_enabled = true

[profiles.fast]
model = "grok-code-fast-1"
temperature = 0.3
```

### Config Profiles

Named profiles are deep-merged with base config. Use via `buddy --profile <name>`.

### Config Mutator

Set values at runtime:

```bash
/config set model_pairs.architect "claude-sonnet-4"
/config set agent_defaults.imageGenerationModel "dall-e-3"
```

Supports dot-notation, SecretRef resolution, dry-run mode, and batch JSON.

## Project Settings

`.codebuddy/settings.json`:

```json
{
  "systemPrompt": "You are working on a TypeScript project.",
  "tools": {
    "enabled": ["read_file", "search", "bash"],
    "disabled": ["web_search"]
  },
  "security": {
    "mode": "auto-edit",
    "bashAllowlist": ["npm *", "git *"]
  },
  "codebuddyMdExcludes": ["packages/legacy/**"],
  "channels": {
    "telegram": {
      "type": "telegram",
      "token": "...",
      "adminUsers": ["user_id"]
    }
  }
}
```

## Model-Aware Limits

`src/config/model-tools.ts` defines per-model capabilities with glob matching (e.g., `grok-3*`, `claude-*`):

- `contextWindow` -- total context window size
- `maxOutputTokens` -- maximum response tokens
- `patchFormat` -- preferred patch format for the model

Used by `client.ts` for response size and `context-manager-v2.ts` for context budget.

## Advanced Config (Effort Levels)

`src/config/advanced-config.ts` defines effort levels:

| Level | Temperature | Token Budget |
|:------|:------------|:-------------|
| `low` | Lower | Reduced |
| `medium` | Default | Standard |
| `high` | Higher | Increased |

## Identity Files

Identity system for customizing agent personality:
- `SOUL.md` -- agent personality and behavior
- `USER.md` -- user information and preferences
- `AGENTS.md` -- agent-specific instructions

Located in project root or `.codebuddy/`. Hot-reload supported.

```bash
buddy identity show          # List loaded identity files
buddy identity get <name>    # Show specific file
buddy identity set <name>    # Edit identity file
buddy identity prompt        # Show combined identity prompt
```

## Personas

Hot-reloadable personality presets:

```
/persona list                # List available personas
/persona use <name>          # Switch persona
/persona info <name>         # Show persona details
/persona reset               # Reset to default
```

## i18n

6 locales supported: English (complete), French (complete), German, Spanish, Japanese, Chinese (stubs). Use the `t()` function from `src/i18n/index.ts`.
