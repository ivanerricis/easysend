#!/usr/bin/env bash
# Deploys an EasySend release on the host (LXC) with Docker Compose.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

NO_SCRIPT_UPDATE=0

usage() {
  cat <<'EOF'
Usage: scripts/deploy.sh [VERSION] [--force] [--yes] [--no-script-update]

Deploys VERSION (e.g. 0.1.0 or v0.1.0). Without VERSION the latest GitHub release is used.

What it does:
  1. checks docker, compose v2, curl and .env;
  2. remembers the current version and docker-compose.yml in .deploy/;
  3. downloads the docker-compose.yml of the release tag and validates it;
  4. backs up the database (if the stack is running);
  5. pulls the images, updates APP_VERSION in .env, runs `docker compose up -d --wait`;
  6. checks /health and the reported version;
  7. updates the scripts themselves (deploy, rollback, backup, uninstall, update runner/service, lib/common.sh) to the
     ones of the release tag: they are downloaded, validated (`bash -n`), the current copies are
     saved in .deploy/previous-scripts/ and replaced atomically. A failure here only prints a
     warning with the manual command: it never fails or rolls back the deploy.
If anything fails after the switch, the previous version, compose file and database are
restored automatically and the script exits with an error.

Options:
  --force   redeploy even if VERSION is already the current one
  --yes     do not ask for confirmation
  --no-script-update  leave the scripts as they are
  -h, --help

Environment:
  EASYSEND_DIR                   install directory (default: parent of scripts/)
  GITHUB_REPO                    owner/name (default: ivanerricis/easysend)
  EASYSEND_SKIP_DOWNLOADS=1      do not download compose file and scripts (old name EASYSEND_SKIP_COMPOSE_DOWNLOAD works too)
  EASYSEND_RAW_BASE              base URL of raw files (default: https://raw.githubusercontent.com/$GITHUB_REPO)
  DEPLOY_WAIT_TIMEOUT            seconds to wait for healthy containers (default: 180)
  EASYSEND_UPDATE_STATUS         set by scripts/update-runner.sh: path of updates/status.json, progress steps are written there

Exit codes: 0 ok; 1 generic error; 75 another deploy/rollback is running; 20 compose file download/validation
failed and 21 database backup failed (stack untouched); 30 deploy failed, automatic rollback succeeded;
31 deploy failed and the rollback did not complete.
EOF
}

# Prints the version of the latest release (without leading "v").
latest_version() {
  local json tag
  json="$(curl -fsSL --max-time 30 "https://api.github.com/repos/$GITHUB_REPO/releases/latest")" ||
    die "Could not fetch the latest release of $GITHUB_REPO. Pass the version explicitly."
  tag="$(parse_tag_name <<<"$json" || true)"
  normalize_version "$tag" || die "Latest release has an unexpected tag: '${tag:-<empty>}'."
}

# Downloads the compose file of a release tag, validates it and installs it. Returns non-zero on failure.
install_release_compose() {
  local version="$1" tmp
  update_step compose
  if downloads_skipped; then
    log "Keeping the existing docker-compose.yml (downloads disabled)."
    return 0
  fi
  tmp="$(mktemp "$DEPLOY_DIR/compose.XXXXXX")"
  if ! curl -fsSL --max-time 60 -o "$tmp" \
    "$(raw_base)/v$version/docker-compose.yml"; then
    rm -f "$tmp"
    err "Could not download docker-compose.yml for v$version."
    return 1
  fi
  if ! APP_VERSION="$version" docker compose --project-directory "$EASYSEND_DIR" -f "$tmp" config -q; then
    rm -f "$tmp"
    err "The downloaded docker-compose.yml is not valid."
    return 1
  fi
  chmod 644 "$tmp"
  mv "$tmp" "$EASYSEND_DIR/docker-compose.yml"
  ok "docker-compose.yml updated to the one of v$version."
}

# Downloads the scripts of a release tag into a temp dir, validates them, saves the current ones
# in .deploy/previous-scripts/ and replaces them. Returns non-zero (and changes nothing) on failure.
update_scripts() {
  local version="$1" tmp f
  tmp="$(mktemp -d "$DEPLOY_DIR/scripts-new.XXXXXX")"
  for f in "${SCRIPT_FILES[@]}"; do
    mkdir -p "$tmp/$(dirname "$f")"
    if ! curl -fsSL --max-time 60 -o "$tmp/$f" "$(raw_base)/v$version/$f"; then
      err "Could not download $f for v$version."
      rm -rf "$tmp"
      return 1
    fi
    if [[ ! -s "$tmp/$f" ]]; then
      err "Downloaded $f is empty."
      rm -rf "$tmp"
      return 1
    fi
    if [[ "$f" != scripts/lib/* && "$(head -n 1 "$tmp/$f")" != '#!/usr/bin/env bash' ]]; then
      err "Downloaded $f does not start with '#!/usr/bin/env bash'."
      rm -rf "$tmp"
      return 1
    fi
    if ! bash -n "$tmp/$f"; then
      err "Downloaded $f has a syntax error."
      rm -rf "$tmp"
      return 1
    fi
  done
  snapshot_scripts "$DEPLOY_DIR/previous-scripts" || { rm -rf "$tmp"; return 1; }
  install_scripts_from "$tmp" || { rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"
  ok "Scripts updated to the ones of v$version (previous copies in .deploy/previous-scripts/)."
}

# Runs update_scripts after a successful deploy; never fails the deploy.
maybe_update_scripts() {
  local version="$1"
  if ((NO_SCRIPT_UPDATE)) || downloads_skipped; then
    log "Scripts not updated (disabled)."
    rm -rf "$DEPLOY_DIR/previous-scripts"
    return 0
  fi
  log "Updating the scripts to v$version..."
  if ! update_scripts "$version"; then
    rm -rf "$DEPLOY_DIR/previous-scripts"
    warn "The scripts were NOT updated (the deploy itself succeeded). To update them by hand:"
    warn "  for f in ${SCRIPT_FILES[*]}; do curl -fsSL -o \$f $(raw_base)/v$version/\$f; done; chmod +x scripts/*.sh"
  fi
  return 0
}

# Brings the stack to PREVIOUS after a failed deploy. Arguments: version, saved compose, db backup name.
auto_rollback() {
  local prev="$1" prev_compose="$2" backup="$3"
  update_step rollback
  warn "Rolling back to ${prev:-<nothing>}..."
  if [[ -z "$prev" ]]; then
    warn "This was the first install: nothing to go back to. Inspect with: docker compose logs"
    return 1
  fi
  [[ -f "$prev_compose" ]] && cp -f "$prev_compose" "$EASYSEND_DIR/docker-compose.yml"
  set_env_var APP_VERSION "$prev"
  dc stop api || true
  if [[ -n "$backup" ]]; then
    log "Restoring database backup $backup..."
    dc run --rm --no-deps -T api node dist/cli/restore-db.js "$backup" ||
      { err "Database restore failed: restore $backup manually (see https://ivanerricis.github.io/easysend/guide/backup)."; return 1; }
  fi
  dc up -d --wait --wait-timeout "${DEPLOY_WAIT_TIMEOUT:-180}" || return 1
  wait_healthy "$prev" 30 || return 1
  ok "Rolled back to $prev."
}

# The actual switch. Every step returns non-zero on failure (called inside `if`, where set -e is off).
switch_to() {
  local version="$1"
  update_step pull
  log "Pulling images for $version..."
  set_env_var APP_VERSION "$version"
  dc pull --quiet || return 1
  update_step restart
  mkdir -p "$EASYSEND_DIR/updates" # so Docker never creates the bind mount source as root
  log "Starting the stack (waiting up to ${DEPLOY_WAIT_TIMEOUT:-180}s for healthy containers)..."
  dc up -d --wait --wait-timeout "${DEPLOY_WAIT_TIMEOUT:-180}" --remove-orphans || return 1
  update_step health
  log "Checking /health..."
  wait_healthy "$version" 30 || return 1
}

main() {
  local version='' force=0
  while (($#)); do
    case "$1" in
      -h | --help) usage; exit 0 ;;
      --force) force=1 ;;
      --no-script-update) NO_SCRIPT_UPDATE=1 ;;
      --yes | -y) ASSUME_YES=1 ;;
      -*) usage >&2; die "Unknown option: $1" ;;
      *) [[ -z "$version" ]] || die "Only one version can be given."; version="$1" ;;
    esac
    shift
  done

  init_env
  command -v curl >/dev/null 2>&1 || die "curl is not installed."
  check_docker
  check_env_file
  acquire_lock
  mkdir -p "$EASYSEND_DIR/updates"

  if [[ -n "$version" ]]; then
    local raw="$version"
    version="$(normalize_version "$raw")" || die "Invalid version '$raw' (expected e.g. 0.1.0 or v0.1.0)."
  else
    log "Looking up the latest release of $GITHUB_REPO..."
    version="$(latest_version)"
  fi

  local current
  current="$(state_get current-version)"
  [[ -n "$current" ]] || current="$(get_env_var APP_VERSION)"

  if [[ "$current" == "$version" && $force -eq 0 ]] && api_running; then
    ok "Version $version is already deployed and running (use --force to redeploy)."
    exit 0
  fi
  log "Deploying ${current:-<first install>} -> $version"
  confirm "Proceed?" || die "Aborted."

  # Remember where we come from (promoted to previous-compose.yml only if the deploy succeeds).
  cp -f "$EASYSEND_DIR/docker-compose.yml" "$DEPLOY_DIR/compose-before.yml" 2>/dev/null || true
  local previous_for_rollback="$current"

  install_release_compose "$version" || {
    cp -f "$DEPLOY_DIR/compose-before.yml" "$EASYSEND_DIR/docker-compose.yml" 2>/dev/null || true
    die_code "$EXIT_COMPOSE" "Deploy aborted before any change to the running stack."
  }

  local backup=''
  if [[ -z "$current" ]]; then
    log "First install: no database to back up."
  elif api_running; then
    update_step backup
    log "Backing up the database..."
    backup="$(db_backup)" || {
      cp -f "$DEPLOY_DIR/compose-before.yml" "$EASYSEND_DIR/docker-compose.yml" 2>/dev/null || true
      die_code "$EXIT_BACKUP" "Deploy aborted: could not back up the database (stack untouched)."
    }
    ok "Database backup: $backup"
  else
    warn "The api is not running: skipping the database backup."
  fi

  if switch_to "$version"; then
    if [[ -n "$previous_for_rollback" && "$previous_for_rollback" != "$version" ]]; then
      state_set previous-version "$previous_for_rollback"
      cp -f "$DEPLOY_DIR/compose-before.yml" "$DEPLOY_DIR/previous-compose.yml" 2>/dev/null || true
    fi
    state_set current-version "$version"
    state_set last-backup "$backup"
    history_add "deploy ${current:-none} -> $version ok backup=${backup:-none}"
    ok "EasySend $version is running."
    log "Summary: version=$version previous=$(state_get previous-version) db-backup=${backup:-none}"
    maybe_update_scripts "$version"
    log "Old images stay on disk for rollbacks. To free space later: docker image prune -a"
    return 0
  fi

  err "Deploy of $version failed."
  history_add "deploy ${current:-none} -> $version FAILED backup=${backup:-none}"
  if auto_rollback "$previous_for_rollback" "$DEPLOY_DIR/compose-before.yml" "$backup"; then
    history_add "auto-rollback to $previous_for_rollback ok"
    die_code "$EXIT_ROLLED_BACK" "Version $version did not start; the stack is back on $previous_for_rollback with its database."
  fi
  history_add "auto-rollback to ${previous_for_rollback:-none} FAILED"
  die_code "$EXIT_ROLLBACK_FAILED" "Deploy failed and the automatic rollback did not complete. Check 'docker compose ps' and 'docker compose logs'."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
