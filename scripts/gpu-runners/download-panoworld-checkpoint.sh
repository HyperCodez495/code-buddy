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
fi

ACTUAL_SIZE="$(stat --format='%s' "$FINAL_PATH")"
if [[ "$ACTUAL_SIZE" != "$EXPECTED_SIZE" ]]; then
  echo "checkpoint size mismatch: expected $EXPECTED_SIZE, found $ACTUAL_SIZE" >&2
  exit 1
fi
echo "$EXPECTED_SHA256  $FINAL_PATH" | sha256sum --check --status
echo "PanoWorld $PROFILE checkpoint verified: $FINAL_PATH"
