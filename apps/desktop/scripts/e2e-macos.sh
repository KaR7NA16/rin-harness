#!/usr/bin/env bash
set -Eeuo pipefail

dmg_path="$(find apps/desktop/src-tauri/target -type f -path '*/bundle/dmg/*.dmg' -print -quit)"
if [[ -z "$dmg_path" ]]; then
  echo 'DMG installer was not produced.' >&2
  exit 1
fi

e2e_dir="$RUNNER_TEMP/rin-desktop-e2e"
mount_dir="$e2e_dir/mount"
install_dir="$e2e_dir/install"
mkdir -p "$mount_dir" "$install_dir"
gui_pid=''
mounted=0
cleanup() {
  if [[ -n "$gui_pid" ]] && kill -0 "$gui_pid" 2>/dev/null; then
    kill -KILL "$gui_pid" 2>/dev/null || true
    wait "$gui_pid" 2>/dev/null || true
  fi
  pkill -f '[r]in-sidecar' 2>/dev/null || true
  if [[ "$mounted" == 1 ]]; then
    hdiutil detach "$mount_dir" -force >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

hdiutil attach "$dmg_path" -readonly -nobrowse -mountpoint "$mount_dir"
mounted=1
app_source="$(find "$mount_dir" -maxdepth 2 -type d -name 'rin.app' -print -quit)"
if [[ -z "$app_source" ]]; then
  echo 'rin.app was not found in the mounted DMG.' >&2
  exit 1
fi
ditto "$app_source" "$install_dir/rin.app"
hdiutil detach "$mount_dir"
mounted=0

app_binary="$install_dir/rin.app/Contents/MacOS/rin"
test -x "$app_binary"
mkdir -p "$e2e_dir/home"
env -u NODE_OPTIONS -u NODE_PATH PATH=/usr/bin:/bin RIN_HOME="$e2e_dir/home"   "$app_binary" >"$e2e_dir/rin.log" 2>&1 &
gui_pid=$!

healthy=0
for _ in $(seq 1 90); do
  if curl --fail --silent --show-error http://127.0.0.1:8320/api/status >"$e2e_dir/status.json"; then
    healthy=1
    break
  fi
  if ! kill -0 "$gui_pid" 2>/dev/null; then
    cat "$e2e_dir/rin.log"
    exit 1
  fi
  sleep 1
done
if [[ "$healthy" != 1 ]]; then
  cat "$e2e_dir/rin.log"
  echo 'Installed rin did not expose /api/status within 90 seconds.' >&2
  exit 1
fi
grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' "$e2e_dir/status.json"
cat "$e2e_dir/status.json"

kill -KILL "$gui_pid"
wait "$gui_pid" 2>/dev/null || true
gui_pid=''
for _ in $(seq 1 20); do
  pgrep -f '[r]in-sidecar' >/dev/null || break
  sleep 1
done
if pgrep -f '[r]in-sidecar' >/dev/null; then
  cat "$e2e_dir/rin.log"
  echo 'rin-sidecar remained after the GUI was force-killed.' >&2
  exit 1
fi
