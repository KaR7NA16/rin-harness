#!/usr/bin/env bash
# Publish every public @rin/* workspace package to npm at its exact pinned
# version. Requires npm auth (npm whoami) and the .dsh_env PATH context.
# Usage: bash rin/scripts/publish-rin.sh [--dry-run]
set -euo pipefail
cd "$(dirname "$0")/../.."

DRY=""
[ "${1:-}" = "--dry-run" ] && DRY="--dry-run"

for mf in rin/*/*/package.json; do
  name=$(node -p "require('./$mf').name || ''")
  private=$(node -p "require('./$mf').private === true")
  if [ -z "$name" ] || [ "$private" = "true" ]; then
    continue
  fi
  echo ">> publish $name"
  pnpm --filter "$name" publish --no-git-checks $DRY
done
echo "done"