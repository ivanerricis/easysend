#!/bin/sh
# Waits for the setup wizard to write the tunnel token, then runs cloudflared.
# The token goes through the environment of the exec'd process, never argv,
# so it does not show up in `ps`.
set -eu

token_file="${SHARED_DIR:-/shared}/tunnel-token"
waited=0

while [ ! -s "$token_file" ]; do
  if [ $((waited % 60)) -eq 0 ]; then
    echo "cloudflared: waiting for tunnel token"
  fi
  sleep 5
  waited=$((waited + 5))
done

echo "cloudflared: tunnel token found, starting tunnel"
TUNNEL_TOKEN="$(cat "$token_file")"
export TUNNEL_TOKEN
exec cloudflared tunnel --no-autoupdate run
