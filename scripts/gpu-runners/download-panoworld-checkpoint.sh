#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-1024}"
CHECKPOINT_DIR="${2:-/mnt/d/DEV/PanoWorld/checkpoints}"
BASE_URL='https://huggingface.co/JiaJinrang/PanoWorld/resolve/main/model_ckpt'
EXPECTED_SIZE=4975828190

case "$PROFILE" in
  1024)
    FILENAME='ckpt_panoworld_lrm_1024_512.pt'
    EXPECTED_SHA256='cdeab498f14b4bdcdec6b3b31b46945daa82bca06ce4fb531f3c087b223c3fca'
    ;;
  2048)
    FILENAME='ckpt_panoworld_lrm_2048_1024.ckpt'
    EXPECTED_SHA256='ec02ec050e7647aef7aebb318c8f768feddeeaaee3d9d159c021a200f1d1dea7'
    ;;
  *)
    echo 'usage: download-panoworld-checkpoint.sh 1024|2048 [CHECKPOINT_DIR]' >&2
    exit 2
    ;;
esac

mkdir -p -- "$CHECKPOINT_DIR"
FINAL_PATH="$CHECKPOINT_DIR/$FILENAME"
PARTIAL_PATH="$FINAL_PATH.partial"
VERIFIED_DURING_DOWNLOAD=false

if [[ ! -f "$FINAL_PATH" ]]; then
  curl \
    --location \
    --fail \
    --retry 5 \
    --retry-delay 3 \
    --continue-at - \
    --output "$PARTIAL_PATH" \
    "$BASE_URL/$FILENAME"

  ACTUAL_SIZE="$(stat --format='%s' "$PARTIAL_PATH")"
  if [[ "$ACTUAL_SIZE" != "$EXPECTED_SIZE" ]]; then
    echo "checkpoint size mismatch: expected $EXPECTED_SIZE, received $ACTUAL_SIZE" >&2
    exit 1
  fi
  echo "$EXPECTED_SHA256  $PARTIAL_PATH" | sha256sum --check --status
  mv -- "$PARTIAL_PATH" "$FINAL_PATH"
  VERIFIED_DURING_DOWNLOAD=true
fi

ACTUAL_SIZE="$(stat --format='%s' "$FINAL_PATH")"
if [[ "$ACTUAL_SIZE" != "$EXPECTED_SIZE" ]]; then
  echo "checkpoint size mismatch: expected $EXPECTED_SIZE, found $ACTUAL_SIZE" >&2
  exit 1
fi
if [[ "$VERIFIED_DURING_DOWNLOAD" != true ]]; then
  echo "$EXPECTED_SHA256  $FINAL_PATH" | sha256sum --check --status
fi

python3 - "$FINAL_PATH" "$EXPECTED_SHA256" <<'PYTHON'
import json
import os
from pathlib import Path
import sys

checkpoint = Path(sys.argv[1]).resolve()
digest = sys.argv[2]
stat = checkpoint.stat()
cache = checkpoint.with_name(f"{checkpoint.name}.codebuddy-sha256.json")
temporary = cache.with_suffix(f"{cache.suffix}.tmp")
temporary.write_text(
    json.dumps(
        {
            "version": 1,
            "size": stat.st_size,
            "mtimeNs": stat.st_mtime_ns,
            "sha256": digest,
        },
        indent=2,
    )
    + "\n",
    encoding="utf-8",
)
os.replace(temporary, cache)
PYTHON

echo "PanoWorld $PROFILE checkpoint verified: $FINAL_PATH"
