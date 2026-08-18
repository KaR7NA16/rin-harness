#!/usr/bin/env bash
# sync-rin-dsh.sh — sync rin's vendored dsh layer from an upstream deepseek-harness ref,
# preserving rin's customizations (see dsh-layer-exclusions.txt).
#
# Usage:
#   MODE=dry-run  ./rin/scripts/sync-rin-dsh.sh [REF]   # default: preview only, no writes
#   MODE=apply    ./rin/scripts/sync-rin-dsh.sh [REF]   # safety-tag, sync, install, build, typecheck
#   REF defaults to dsh-v0.1.0-rc.7; pass "upstream/master" for latest main.
set -euo pipefail

REF="${1:-dsh-v0.1.0-rc.7}"
MODE="${MODE:-dry-run}"
SCOPE=(packages vendor apps website native scripts)
EXCL_FILE="rin/scripts/dsh-layer-exclusions.txt"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if ! git remote | grep -qx upstream; then
  git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git
fi

echo ">> fetching upstream..."
git fetch upstream --tags

if ! git rev-parse --verify "${REF}^{commit}" >/dev/null 2>&1; then
  echo "!! ref not found: $REF" >&2
  exit 1
fi
echo ">> target: $REF ($(git rev-parse --short "${REF}^{commit}"))"

declare -a EXCL
while IFS= read -r line; do
  case "$line" in '' | '#'*) continue ;; esac
  EXCL+=("$line")
done < "$EXCL_FILE"

pspec=("${SCOPE[@]}")
for f in "${EXCL[@]}"; do
  pspec+=(":(exclude)$f")
done

if [ "$MODE" = apply ]; then
  dirty="$(git status --porcelain -- "${SCOPE[@]}")"
  if [ -n "$dirty" ]; then
    echo "!! uncommitted changes exist inside sync scope — commit or stash them first:" >&2
    echo "$dirty" >&2
    exit 1
  fi
  tag="rin-pre-sync-$(date +%Y%m%d-%H%M%S)"
  git tag "$tag"
  echo ">> safety tag: $tag"

  echo ">> syncing dsh layer to $REF (excluded ${#EXCL[@]} rin-custom files)..."
  git checkout "$REF" -- "${SCOPE[@]}"
  for f in "${EXCL[@]}"; do
    if git cat-file -e "HEAD:$f" 2>/dev/null; then
      git checkout HEAD -- "$f"
    fi
  done

  [ -f ~/.dsh_env.sh ] && . ~/.dsh_env.sh
  echo ">> pnpm install..."
  pnpm install
  echo ">> pnpm build..."
  pnpm build
  echo ">> rin:typecheck..."
  pnpm run rin:typecheck

  echo ""
  echo ">> DONE. Review the diff, then commit."
  git status --short | head -40
  echo ""
  echo ">> Post-sync verify list:"
  sed -n '/^# VERIFY/,$p' "$EXCL_FILE" | grep -vE '^# VERIFY|^$'
else
  echo ">> DRY-RUN preview only (nothing written)."
  echo ""
  echo ">> diff size vs $REF (scope minus rin-custom exclusions):"
  git diff --stat HEAD "$REF" -- "${pspec[@]}" | tail -6
  echo ""
  echo ">> rin-custom files kept as-is (${#EXCL[@]}):"
  printf '     %s\n' "${EXCL[@]}"
  echo ""
  echo ">> Set MODE=apply to actually sync (safety-tag -> checkout -> install -> build -> typecheck)."
fi