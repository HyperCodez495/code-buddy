#!/usr/bin/env bash
# Demo: the active-LLM registry — list, run together, auto-failover.
# Recorded to a GIF for the README via asciinema + agg.
set -u
cd "$(dirname "$0")/../.."

# `buddy` shim → the in-repo tsx entry (the published CLI is just `buddy`).
buddy() { ./node_modules/.bin/tsx src/index.ts "$@"; }
# Keep the OAuth logins (ChatGPT + xAI) + local Ollama; no API keys in env.
unset GROK_API_KEY XAI_API_KEY

prompt() { printf '\033[1;36m$\033[0m \033[1m%s\033[0m\n' "$1"; sleep 0.7; }
say()    { printf '\033[0;90m# %s\033[0m\n' "$1"; sleep 0.8; }

clear
say "Code Buddy knows every LLM you're logged into — and uses them together."
sleep 0.6

prompt "buddy llm"
LOG_LEVEL=error buddy llm
sleep 2.5
echo

say "Primary down? It auto-continues on the next login. (here we force Grok to 404)"
prompt 'CODEBUDDY_LLM_FAILOVER=1 CODEBUDDY_PROVIDER=xai buddy --model grok-oops -p "Reply: FAILOVER_OK"'
LOG_LEVEL=warn CODEBUDDY_LLM_FAILOVER=1 CODEBUDDY_PROVIDER=xai \
  buddy --model grok-oops -p "Reply with exactly: FAILOVER_OK" --output-format text 2>&1 \
  | grep -iE "trying fallback|FAILOVER_OK" \
  | sed -E 's/.*trying fallback provider.*fallbackProvider":"([a-z]+)".*/  ⚠ primary failed → failing over to \1 …/; s/^FAILOVER_OK$/  ✅ FAILOVER_OK   (answered by the next active LLM)/'
sleep 2.5
echo
say "Free + local, your subscriptions, or all of them at once. \$0 by default."
sleep 1.2
