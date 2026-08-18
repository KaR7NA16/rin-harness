#!/usr/bin/env bash
# bump-dsh-deps.sh — bump the pinned @deepseek-ai/dsh-* registry group to one version.
#
# The whole dsh group ships together under the `next` dist-tag on the
# 0.1.0-rc.* line (the `latest` tag is stale at 0.0.1-rc.1), and rin pins the
# group exactly (evidence #1/#2 in rin/DEPENDENCY-STRATEGY.md). Only
# @deepseek-ai/dsh-* entries are rewritten; koishi-ecosystem deps
# (cordis/cosmokit/schemastery/cordis-plugin-*) keep their own versions.
#
# usage:
#   MODE=dry-run ./rin/scripts/bump-dsh-deps.sh [TARGET]   # preview only (default)
#   MODE=apply   ./rin/scripts/bump-dsh-deps.sh [TARGET]   # rewrite pins, install, typecheck, diff
#   TARGET defaults to `npm view @deepseek-ai/dsh-base dist-tags.next`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

MODE="${MODE:-dry-run}"
ANCHOR='@deepseek-ai/dsh-base'

if [ -f ~/.dsh_env.sh ]; then . ~/.dsh_env.sh; fi

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  TARGET="$(npm view "$ANCHOR" dist-tags.next 2>/dev/null)"
fi
if [ -z "$TARGET" ]; then
  echo "!! could not read $ANCHOR dist-tags.next from the registry" >&2
  exit 1
fi

echo ">> current pins:"
grep -rho '"@deepseek-ai/dsh-[^"]*": *"[^"]*"' rin --include='package.json' 2>/dev/null | sort -u

CUR="$(grep -rho '"@deepseek-ai/dsh-base": *"[^"]*"' rin --include='package.json' 2>/dev/null | head -1 | sed -E 's/.*"([^"]*)"$/\1/')"
echo ">> current: $ANCHOR@${CUR:-?}"
echo ">> target:  $ANCHOR@$TARGET"

if [ "$CUR" = "$TARGET" ]; then
  echo ">> already at $TARGET; nothing to do."
  exit 0
fi

if [ "$MODE" != "apply" ]; then
  echo ">> dry-run: pass MODE=apply to rewrite pins, pnpm install, and rin:typecheck"
  exit 0
fi

echo ">> rewriting @deepseek-ai/dsh-* pins to $TARGET ..."
mapfile -t FILES < <(grep -rl '"@deepseek-ai/dsh-' rin --include='package.json' 2>/dev/null | grep -v node_modules || true)
for f in "${FILES[@]}"; do
  sed -i -E "s/(\"@deepseek-ai\/dsh-[^\"]*\"): *\"[^\"]*\"/\1: \"$TARGET\"/g" "$f"
  echo "   $f"
done

echo ">> pnpm install..."
pnpm install

echo ">> rin:typecheck..."
pnpm run rin:typecheck

echo ">> diff (review):"
git diff --stat -- 'rin/**/package.json' pnpm-lock.yaml