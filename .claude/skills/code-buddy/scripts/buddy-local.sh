#!/usr/bin/env bash
# Run Code Buddy headless, pinned to a FREE local Ollama model.
#
# Forces the ollama provider (CODEBUDDY_PROVIDER=ollama) so an active ChatGPT
# login doesn't override it, and defaults to a tool-capable model (qwen3) so the
# agent can actually edit files — qwen2.5:7b is chat-only and won't.
#
# The agent's working directory is your current cwd (so run it from a sandbox to
# bound where edits land); the `buddy` entrypoint is resolved independently:
# global `buddy` if installed, else the code-buddy repo this script lives in.
#
# Usage:   buddy-local.sh "<prompt>" [extra buddy flags...]
# Env:     CB_LOCAL_MODEL (default qwen3.6:35b-a3b-q4_K_M), OLLAMA_HOST (default localhost:11434)
set -euo pipefail

MODEL="${CB_LOCAL_MODEL:-qwen3.6:35b-a3b-q4_K_M}"
HOST="${OLLAMA_HOST:-http://localhost:11434}"

if [ "$#" -lt 1 ]; then
  echo "usage: buddy-local.sh \"<prompt>\" [extra buddy flags...]" >&2
  exit 2
fi
prompt="$1"; shift || true

# Repo root = four levels up from this script (.claude/skills/code-buddy/scripts).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

# Resolve the buddy entrypoint (prefer a global install, then the repo).
if command -v buddy >/dev/null 2>&1; then
  RUN=(buddy)
elif [ -x "$REPO_ROOT/node_modules/.bin/tsx" ] && [ -f "$REPO_ROOT/src/index.ts" ]; then
  RUN=("$REPO_ROOT/node_modules/.bin/tsx" "$REPO_ROOT/src/index.ts")
elif [ -f "$REPO_ROOT/dist/index.js" ]; then
  RUN=(node "$REPO_ROOT/dist/index.js")
else
  echo "No buddy entrypoint found (no global 'buddy', and $REPO_ROOT is not a built code-buddy repo)." >&2
  exit 1
fi

CODEBUDDY_PROVIDER=ollama OLLAMA_HOST="$HOST" GROK_MODEL="$MODEL" \
  "${RUN[@]}" -p "$prompt" --permission-mode acceptEdits --output-format text "$@"
