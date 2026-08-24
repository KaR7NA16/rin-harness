#!/usr/bin/env bash
# Update the external ~/deepseek-harness checkout used for dsh web development.
# usage: ./tooling/scripts/update-dsh.sh [tag]   # default: newest dsh-v* tag from origin
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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
"$REPO_ROOT/tooling/scripts/dsh-web.sh" restart 2>/dev/null || ~/rin-harness/tooling/scripts/dsh-web.sh restart
echo ">> done: $DSH at $TAG"
