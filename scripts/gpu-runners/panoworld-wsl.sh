#!/usr/bin/env bash
set -euo pipefail

ENV_DIR="${CODEBUDDY_PANOWORLD_ENV:-$HOME/.conda-envs/panoworld}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

export CUDA_HOME="$ENV_DIR"
export PATH="$ENV_DIR/bin:$PATH"
export CC="$ENV_DIR/bin/x86_64-conda-linux-gnu-cc"
export CXX="$ENV_DIR/bin/x86_64-conda-linux-gnu-c++"
export TORCH_EXTENSIONS_DIR="${TORCH_EXTENSIONS_DIR:-$HOME/.cache/torch_extensions/panoworld}"
export TORCH_CUDA_ARCH_LIST="${TORCH_CUDA_ARCH_LIST:-8.6}"
export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0}"
export MAX_JOBS="${MAX_JOBS:-2}"

exec "$ENV_DIR/bin/python" "$SCRIPT_DIR/panoworld-runner.py" "$@"
