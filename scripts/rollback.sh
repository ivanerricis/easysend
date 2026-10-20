#!/usr/bin/env bash
# Goes back to the version that was running before the last deploy.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

usage() {
  cat <<'USAGE'
Usage: scripts/rollback.sh [--keep-db] [--yes]

Restores the previous version recorded in .deploy/ together with its docker-compose.yml and,
unless --keep-db is given, the database backup taken by the last deploy.

WARNING: restoring the database discards everything written since that deploy (new transfers,
users, settings). The database as it is now is saved first as app-pre-restore-<time>.sqlite in
the backups directory of the data volume. With --keep-db the data stays, but an older version
may not understand a database migrated by a newer one.

Options:
  --keep-db   do not touch the database
  --yes       do not ask for confirmation
  -h, --help

Environment: EASYSEND_DIR, DEPLOY_WAIT_TIMEOUT (see deploy.sh).
USAGE
}

main() {
  local keep_db=0
  while (($#)); do
    case "$1" in
      -h | --help) usage; exit 0 ;;
      --keep-db) keep_db=1 ;;
      --yes | -y) ASSUME_YES=1 ;;
      *) usage >&2; die "Unknown option: $1" ;;
    esac
    shift
  done

  init_env
  check_docker
  check_env_file
  acquire_lock

  local current previous backup
  current="$(state_get current-version)"
  [[ -n "$current" ]] || current="$(get_env_var APP_VERSION)"
  previous="$(state_get previous-version)"
  backup="$(state_get last-backup)"
  [[ -n "$previous" ]] || die "No previous version recorded in $DEPLOY_DIR: nothing to roll back to."
  [[ -f "$DEPLOY_DIR/previous-compose.yml" ]] || die "The saved previous-compose.yml is missing."

  log "Current version : ${current:-unknown}"
  log "Previous version: $previous"
  if ((keep_db)); then
    log "Database        : kept as it is (--keep-db)"
  elif [[ -n "$backup" ]]; then
    log "Database        : will be restored from backup $backup"
    warn "Data written since that backup will be lost."
  else
    warn "No database backup is recorded for the last deploy: the database will be kept as it is."
    keep_db=1
  fi
  confirm "Roll back to $previous?" || die "Aborted."

  cp -f "$EASYSEND_DIR/docker-compose.yml" "$DEPLOY_DIR/compose-before.yml"
  cp -f "$DEPLOY_DIR/previous-compose.yml" "$EASYSEND_DIR/docker-compose.yml"
  set_env_var APP_VERSION "$previous"

  log "Stopping the api..."
  dc stop api
  if ((! keep_db)); then
    log "Restoring database backup $backup..."
    dc run --rm --no-deps -T api node dist/cli/restore-db.js "$backup" ||
      die "Database restore failed. The files of the left-over version are in place; fix the problem and rerun."
  fi

  log "Starting $previous..."
  dc pull --quiet || warn "Could not pull images: using the ones already on disk."
  dc up -d --wait --wait-timeout "${DEPLOY_WAIT_TIMEOUT:-180}" --remove-orphans ||
    die "Stack did not become healthy. Check 'docker compose ps' and 'docker compose logs'."
  wait_healthy "$previous" 30 || die "/health does not report $previous."

  # Swap, so that `deploy.sh <newer>` or another rollback behave sensibly.
  if [[ -n "$current" ]]; then
    state_set previous-version "$current"
    cp -f "$DEPLOY_DIR/compose-before.yml" "$DEPLOY_DIR/previous-compose.yml"
  fi
  state_set current-version "$previous"
  state_set last-backup ""
  history_add "rollback ${current:-unknown} -> $previous ok db=$((keep_db)) backup=${backup:-none}"
  ok "EasySend $previous is running again."
}

main "$@"
