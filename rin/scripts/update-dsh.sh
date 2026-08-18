#!/usr/bin/env bash
# update-dsh.sh — update the vendored ~/deepseek-harness clone (upstream base + rin's web UI).
# usage: ./rin/scripts/update-dsh.sh [tag]   # default: newest dsh-v* tag from origin
set -euo pipefail

DSH=~/deepseek-harness
cd "$DSH"

echo ">> fetching origin..."
git fetch origin --tags

TAG="${1:-$(git tag --list 'dsh-v*' --sort=-v:refname | head -1)}"
if [ -z "$TAG" ]; then echo "!! no tag specified and none found" >&2; exit 1; fi

CUR="$(git describe --tags 2>/dev/null || echo untagged)"
echo ">> current: $CUR"
echo ">> target:  $TAG ($(git rev-parse --short "$TAG"))"

if [ "$CUR" = "$TAG" ]; then
  echo ">> already at $TAG; nothing to do."
  exit 0
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "!! uncommitted changes in $DSH — commit or stash first" >&2
  exit 1
fi

git checkout "$TAG"

[ -f ~/.dsh_env.sh ] && . ~/.dsh_env.sh
echo ">> pnpm install..."
pnpm install
echo ">> pnpm build..."
pnpm build

echo ">> restarting dsh web..."
"$OLDPWD"/rin/scripts/dsh-web.sh restart 2>/dev/null || ~/rin-harness/rin/scripts/dsh-web.sh restart
echo ">> done: $DSH at $TAG"