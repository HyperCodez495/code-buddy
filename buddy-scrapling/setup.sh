#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="${HOME}/.codebuddy/scrapling/.venv"

mkdir -p "$(dirname "$VENV_DIR")"
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install -r "$SCRIPT_DIR/requirements.txt"

if [ "${BUDDY_SCRAPLING_INSTALL_BROWSERS:-0}" = "1" ]; then
  "$VENV_DIR/bin/scrapling" install
else
  echo "[setup] browser runtimes skipped; set BUDDY_SCRAPLING_INSTALL_BROWSERS=1 for stealth/dynamic modes."
fi

echo "[setup] Scrapling installed in $VENV_DIR"
