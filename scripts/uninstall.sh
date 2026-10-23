#!/usr/bin/env bash
# Removes the EasySend containers and images; with --purge also data and configuration.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

usage() {
  cat <<'USAGE'
Usage: scripts/uninstall.sh [--purge] [--yes]

Default: stops and removes the containers and network (including the cloudflared profile) and
removes the EasySend images. Data volumes, .env and .deploy/ are KEPT, so a later
`scripts/deploy.sh <version>` brings everything back.

--purge  ALSO deletes the data volumes (all transfers, users, the master key), .deploy/ and .env.
         The backups directory is kept. You are offered a backup first and must type 'easysend'.
--yes    do not ask questions (with --purge no backup is made: run backup.sh first)

Cloudflare is not touched (the API token is never stored): after --purge remove the tunnel and
the DNS record by hand, the steps are printed at the end.

Environment: EASYSEND_DIR.
USAGE
}

# Removes the one-click update units (systemd) when they are installed.
remove_update_service() {
  local sdir="${EASYSEND_SYSTEMD_DIR:-/etc/systemd/system}"
  [[ -f "$sdir/easysend-update.path" || -f "$sdir/easysend-update.service" ]] || return 0
  if [[ "$(id -u)" == "0" ]]; then
    EASYSEND_DIR="$EASYSEND_DIR" "$SCRIPT_DIR/update-service.sh" uninstall || warn "Could not remove the one-click update units."
  else
    warn "The one-click update units are still installed. Remove them as root: sudo $SCRIPT_DIR/update-service.sh uninstall"
  fi
}

# Every version we know about (current, previous, .env), one per line.
known_versions() {
  { state_get current-version; echo; state_get previous-version; echo; get_env_var APP_VERSION; } |
    grep -v '^$' | sort -u || true
}

# Removes every local tag of the EasySend images (current, previous and failed deploys alike).
remove_images() {
  local v img repo tag
  local -a repos=()
  for v in "$@"; do
    while IFS= read -r img; do
      if [[ -n "$img" ]]; then repos+=("${img%:*}"); fi
    done < <(APP_VERSION="$v" dc --profile tunnel config --images 2>/dev/null)
  done
  while IFS= read -r repo; do
    [[ -n "$repo" ]] || continue
    while IFS= read -r tag; do
      [[ -n "$tag" ]] || continue
      if docker image rm "$repo:$tag" >/dev/null 2>&1; then
        ok "Image removed: $repo:$tag"
      else
        log "Image in use or already gone: $repo:$tag"
      fi
    done < <(docker image ls --format '{{.Tag}}' "$repo")
  done < <(printf '%s\n' "${repos[@]}" | sort -u)
}

main() {
  local purge=0
  while (($#)); do
    case "$1" in
      -h | --help) usage; exit 0 ;;
      --purge) purge=1 ;;
      --yes | -y) ASSUME_YES=1 ;;
      *) usage >&2; die "Unknown option: $1" ;;
    esac
    shift
  done

  init_env
  check_docker
  acquire_lock

  local versions=() v
  while IFS= read -r v; do
    if [[ -n "$v" ]]; then versions+=("$v"); fi
  done < <(known_versions)
  if ((${#versions[@]} == 0)); then
    warn "No known version: using a placeholder tag to find the containers."
    versions=("0.0.0")
  fi

  if ((purge)); then
    warn "--purge DELETES all data: transfers, users, settings and the master key."
    if [[ "$ASSUME_YES" != "1" ]]; then
      [[ -t 0 ]] || die "--purge needs a terminal (or --yes)."
      local answer
      read -r -p "Make a backup with scripts/backup.sh first? [Y/n] " answer
      if [[ ! "$answer" =~ ^[Nn] ]]; then
        "$SCRIPT_DIR/backup.sh" || die "Backup failed: purge aborted."
      fi
      read -r -p "Type 'easysend' to confirm the permanent deletion: " answer
      [[ "$answer" == "easysend" ]] || die "Aborted."
    fi
  else
    confirm "Remove the EasySend containers and images (data is kept)?" || die "Aborted."
  fi

  remove_update_service
  log "Removing containers and network..."
  if ((purge)); then
    APP_VERSION="${versions[0]}" dc --profile tunnel down --remove-orphans -v
  else
    APP_VERSION="${versions[0]}" dc --profile tunnel down --remove-orphans
  fi
  remove_images "${versions[@]}"

  if ((purge)); then
    rm -rf "$DEPLOY_DIR"
    rm -rf "$EASYSEND_DIR/updates"
    rm -f "$EASYSEND_DIR/.env"
    ok "Data volumes, .deploy/ and .env removed (the backups directory, if any, is kept)."
    cat <<'CF'

Manual Cloudflare cleanup (the API token is never stored, so this cannot be automated):
  1. Cloudflare dashboard -> Zero Trust -> Networks -> Tunnels: delete the tunnel named 'easysend-...'.
  2. Cloudflare dashboard -> your domain -> DNS: delete the CNAME of the app hostname
     (it points to <tunnel-id>.cfargotunnel.com).
  3. If you created a dedicated API token for the setup wizard, revoke it under
     My Profile -> API Tokens.
CF
  else
    ok "Containers and images removed. Volumes, .env and .deploy/ are kept."
    log "Bring it back with: scripts/deploy.sh <version>.  Delete the data with: scripts/uninstall.sh --purge"
  fi
}

main "$@"
