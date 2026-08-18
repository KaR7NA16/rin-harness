#!/usr/bin/env bash
# dsh-web.sh — start/restart/status/stop for the dsh web UI in ~/deepseek-harness.
# Launched with setsid so it survives the WSL session end. The pnpm wrapper process
# spawns the real webserver as a child; always act on the port owner (ss) plus the
# pnpm parent, and never trust $! (GNU setsid forks when not a process-group leader).
# usage: ./rin/scripts/dsh-web.sh {start|restart|status|stop}
set -euo pipefail

DSH=~/deepseek-harness
PORT=3080
ACTION="${1:-start}"
PID_PAT='node .*/bin/pnpm dsh web'

get_pnpm_pid() { pgrep -f "$PID_PAT" | head -1 || true; }

get_port_pid() {
  ss -tlnp 2>/dev/null | grep ":$PORT " | grep -oP 'pid=\K[0-9]+' | head -1 || true
}

get_server_pid() {
  local p
  p="$(get_port_pid)"
  [ -n "$p" ] && { echo "$p"; return; }
  get_pnpm_pid
}

port_free() { ! (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null; }

kill_web() {
  for p in $(get_pnpm_pid) $(get_port_pid); do
    [ -n "$p" ] && kill "$p" 2>/dev/null || true
  done
}

wait_free() {
  for _ in $(seq 1 20); do
    if port_free && [ -z "$(get_pnpm_pid)" ]; then return 0; fi
    sleep 1
  done
  return 1
}

case "$ACTION" in
  status)
    p="$(get_server_pid)"
    if [ -n "$p" ] && ! port_free; then
      echo "running (pid $p)  http://127.0.0.1:$PORT"
    else
      echo "stopped"
      exit 1
    fi
    ;;
  stop)
    kill_web
    wait_free || { echo "!! process did not exit cleanly" >&2; exit 1; }
    rm -f ~/dsh-web.pid
    echo "stopped"
    ;;
  start|restart)
    kill_web
    wait_free || { echo "!! old process still holds port $PORT" >&2; exit 1; }
    rm -f ~/dsh-web.pid
    [ -f ~/.dsh_env.sh ] && . ~/.dsh_env.sh
    cd "$DSH"
    setsid pnpm dsh web </dev/null >~/dsh-web.log 2>&1 &
    for _ in $(seq 1 30); do
      curl -sf -o /dev/null http://127.0.0.1:$PORT/ && break
      sleep 1
    done
    if curl -sf -o /dev/null http://127.0.0.1:$PORT/; then
      p="$(get_server_pid)"
      echo "$p" > ~/dsh-web.pid
      echo "web up: http://127.0.0.1:$PORT (pid $p)"
    else
      echo "!! web not up; tail ~/dsh-web.log:" >&2
      tail -5 ~/dsh-web.log >&2
      exit 1
    fi
    ;;
  *)
    echo "usage: $0 {start|restart|status|stop}" >&2
    exit 2
    ;;
esac