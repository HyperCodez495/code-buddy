#!/usr/bin/env bash
# Demo: one question → every LLM you're logged into answers, then synthesized.
# Recorded to a GIF for the README via asciinema + agg.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
buddy() { "$ROOT"/node_modules/.bin/tsx "$ROOT"/src/index.ts "$@"; }
unset GROK_API_KEY XAI_API_KEY
cd "$ROOT"

prompt() { printf '\033[1;36m$\033[0m \033[1m%s\033[0m\n' "$1"; sleep 0.7; }
say()    { printf '\033[0;90m# %s\033[0m\n' "$1"; sleep 0.8; }

clear
say "One question → every brain you're logged into answers, then it's synthesized. \$0."
prompt 'buddy llm ensemble "In one short sentence: what does git rebase do?"'
LOG_LEVEL=error buddy llm ensemble "In one short sentence, what does git rebase do?" 2>&1 \
  | grep -vaE "PARALLEL EXECUTION RESULT|^(Strategy|Aggregation|Models executed|Effective latency|Total tokens|Confidence|Selected model|Consensus|  Reached|  Agreement)|^═+$|^─+$|^⚡" \
  | sed -E 's/^Running ensemble.*across (.*) …$/  asking \1 …/; s/^── ([a-z]+).*\(([0-9]+)ms.*/▸ \1  (\2ms)/; s/^Response:$/✓ synthesized:/' \
  | cat -s
sleep 1.5
