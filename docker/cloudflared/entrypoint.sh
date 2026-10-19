#!/bin/sh
# Waits for the tunnel token written by the setup wizard / admin panel, runs cloudflared, and
# restarts it when the token file changes (a new tunnel configured later).
# The token goes through the environment of cloudflared, never argv, so it does not show up in
# `ps`, and it is never printed.
set -eu

token_file="${SHARED_DIR:-/shared}/tunnel-token"
pid=""

file_sum() {
  cksum < "$token_file" 2>/dev/null || true
}

start_tunnel() {
  TUNNEL_TOKEN="$(cat "$token_file")" cloudflared tunnel --no-autoupdate run &
  pid=$!
}

stop_tunnel() {
  if [ -n "$pid" ]; then
    kill -TERM "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    pid=""
  fi
}

on_signal() {
  stop_tunnel
  exit 0
}
trap on_signal TERM INT

waited=0
while [ ! -s "$token_file" ]; do
  if [ $((waited % 60)) -eq 0 ]; then
    echo "cloudflared: waiting for tunnel token"
  fi
  sleep 5 &
  wait $! || true
  waited=$((waited + 5))
done

echo "cloudflared: tunnel token found, starting tunnel"
current="$(file_sum)"
start_tunnel

while true; do
  # Poll every 10 s in small steps so signals are handled promptly (the trap runs after `wait`).
  sleep 10 &
  wait $! || true

  if ! kill -0 "$pid" 2>/dev/null; then
    # cloudflared exited on its own: propagate its status so the restart policy applies.
    status=0
    wait "$pid" || status=$?
    exit "$status"
  fi

  if [ -s "$token_file" ]; then
    latest="$(file_sum)"
    if [ "$latest" != "$current" ]; then
      echo "cloudflared: tunnel token changed, restarting tunnel"
      stop_tunnel
      current="$latest"
      start_tunnel
    fi
  fi
done
