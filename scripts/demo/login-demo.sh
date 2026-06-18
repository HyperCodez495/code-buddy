#!/usr/bin/env bash
# Demo: `buddy login xai` — sign in once with your xAI/SuperGrok plan, then Grok is $0.
# The browser OAuth is one-time + interactive, so we narrate it and show the real payoff.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
buddy() { "$ROOT"/node_modules/.bin/tsx "$ROOT"/src/index.ts "$@"; }
unset GROK_API_KEY XAI_API_KEY
cd "$ROOT"

prompt() { printf '\033[1;36m$\033[0m \033[1m%s\033[0m\n' "$1"; sleep 0.7; }
say()    { printf '\033[0;90m# %s\033[0m\n' "$1"; sleep 0.9; }

clear
say "One-time:  buddy login xai   — sign in with your SuperGrok plan in the browser."
say "No API key. From then on, Grok is just another login — and it answers for free:"
prompt 'CODEBUDDY_PROVIDER=xai buddy --model grok-4-latest -p "A haiku about Rust'"'"'s borrow checker"'
LOG_LEVEL=error CODEBUDDY_PROVIDER=xai buddy --model grok-4-latest \
  -p "Write a haiku (3 lines) about Rust's borrow checker. Output only the haiku." --output-format text 2>&1 \
  | grep -vaE "^\s*$" | sed 's/^/  /'
sleep 1
printf '  \033[0;90m… no API key · $0 marginal · your SuperGrok subscription\033[0m\n'
sleep 1.4
