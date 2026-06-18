#!/usr/bin/env bash
# Demo: Code Buddy writes code AND a test, then runs it — on Grok, $0.
# Recorded to a GIF for the README via asciinema + agg.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
buddy() { "$ROOT"/node_modules/.bin/tsx "$ROOT"/src/index.ts "$@"; }
unset GROK_API_KEY XAI_API_KEY
WORK=/tmp/cb-demo-coding; rm -rf "$WORK"; mkdir -p "$WORK"; cd "$WORK"

prompt() { printf '\033[1;36m$\033[0m \033[1m%s\033[0m\n' "$1"; sleep 0.7; }
say()    { printf '\033[0;90m# %s\033[0m\n' "$1"; sleep 0.8; }
green()  { printf '\033[1;32m%s\033[0m\n' "$1"; }

clear
say "Give Code Buddy a task — it writes the code AND a test, then runs it. On Grok, \$0."
prompt 'buddy -p "Create fizzbuzz.mjs + a test, then run the test"'
LOG_LEVEL=info CODEBUDDY_PROVIDER=xai buddy -d "$WORK" --permission-mode acceptEdits --model grok-4-latest \
  -p "Create fizzbuzz.mjs exporting fizzbuzz(n) implementing classic FizzBuzz (15->'FizzBuzz', 3->'Fizz', 5->'Buzz', else the number as a string). Then create fizzbuzz.test.mjs that imports it and process.exit(0) only if fizzbuzz(15)==='FizzBuzz' && fizzbuzz(3)==='Fizz' && fizzbuzz(5)==='Buzz' && fizzbuzz(1)==='1', else process.exit(1). Then run 'node fizzbuzz.test.mjs' and report the exit code." \
  --output-format text 2>&1 \
  | grep -aiE "create_file completed|bash completed" \
  | sed -E 's/.*create_file completed.*/  ⚡ wrote a file/; s/.*bash completed.*/  ⚡ ran the test/'
printf '  \033[0;90m… on Grok via your subscription — no API key, $0 marginal\033[0m\n'
sleep 1
echo
say "What Grok actually wrote:"
prompt "cat fizzbuzz.mjs"
cat fizzbuzz.mjs 2>/dev/null
sleep 1.6
echo
prompt "node fizzbuzz.test.mjs   # the human re-runs it"
if node fizzbuzz.test.mjs 2>/dev/null; then green "  ✅ tests pass (exit 0)"; else printf '  ❌ failed\n'; fi
sleep 1.6
