#!/usr/bin/env bash
# Publish every public @rin/* workspace package at its exact pinned
# version. Requires npm auth (npm whoami) and the .dsh_env PATH context.
# Usage: bash tooling/scripts/publish-rin.sh [--dry-run]
set -euo pipefail
cd "$(dirname "$0")/../.."

DRY=""
[ "${1:-}" = "--dry-run" ] && DRY="--dry-run"

for mf in apps/*/package.json packages/*/*/package.json; do
  [ -f "$mf" ] || continue
  name=$(node -p "require('./$mf').name || ''")
  private=$(node -p "require('./$mf').private === true")
  if [ -z "$name" ] || [ "$private" = "true" ]; then
    continue
  fi
  echo ">> publish $name"
  pnpm --filter "$name" publish --no-git-checks $DRY
done
echo "done"
