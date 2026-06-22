#!/usr/bin/env bash
#
# Rebrand the Code Buddy <-> code-explorer integration plugin
# (was "gitnexus"). Renames the plugin dir, its class files, the test,
# and rewrites identifiers / data-dir / import paths.
#
#   GitNexus            -> CodeExplorer      (CamelCase identifiers + import filenames)
#   .gitnexus           -> .codeexplorer     (data dir read by the manager)
#   plugins/gitnexus    -> plugins/code-explorer  (import paths after the dir move)
#
# The actual binary invocation (npx gitnexus -> code-explorer) is fixed by
# hand because it changes spawn/exec LOGIC, not just strings.
#
# Usage: scripts/rebrand-code-explorer.sh [--apply]
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1

mv_git() { echo "mv: $1 -> $2"; [ "$APPLY" = 1 ] && git mv "$1" "$2"; }

if [ "$APPLY" = 1 ] && [ -d src/plugins/gitnexus ]; then
  git mv src/plugins/gitnexus src/plugins/code-explorer
  git mv src/plugins/code-explorer/GitNexusMCPClient.ts src/plugins/code-explorer/CodeExplorerMCPClient.ts
  git mv src/plugins/code-explorer/GitNexusManager.ts   src/plugins/code-explorer/CodeExplorerManager.ts
  [ -f tests/plugins/gitnexus.test.ts ] && git mv tests/plugins/gitnexus.test.ts tests/plugins/code-explorer.test.ts
else
  echo "mv: src/plugins/gitnexus -> src/plugins/code-explorer (+ class files + test)"
fi

mapfile -t FILES < <(git ls-files '*.ts' '*.tsx' '*.json' | grep -vE '^(node_modules|dist|out)/' || true)
changed=0
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  tmp="$(mktemp)"
  sed -E \
    -e 's/GitNexus/CodeExplorer/g' \
    -e 's/\.gitnexus/.codeexplorer/g' \
    -e 's#plugins/gitnexus#plugins/code-explorer#g' \
    "$f" > "$tmp"
  if ! cmp -s "$f" "$tmp"; then
    changed=$((changed + 1))
    [ "$APPLY" = 1 ] && mv "$tmp" "$f" || rm -f "$tmp"
  else rm -f "$tmp"; fi
done
echo "files with text changes: $changed"
[ "$APPLY" = 1 ] && echo "APPLIED." || echo "(dry-run)"
