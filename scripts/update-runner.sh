#!/usr/bin/env bash
# Runs the update requested from the admin panel (started by the easysend-update.path systemd unit).
#
# The api writes updates/request (id, version, requestedAt); this script consumes it, validates it
# strictly and runs scripts/deploy.sh for that version, reporting progress in updates/status.json.
# The request is consumed on every path, so the path unit never loops. Output of deploy.sh goes
# to .deploy/update.log (the five most recent runs are kept).
#
# Environment: EASYSEND_DIR (install directory, default: parent of scripts/),
#              EASYSEND_DEPLOY_CMD (deploy command, default: scripts/deploy.sh; used by the tests).
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

MAX_REQUEST_BYTES=256
FINALIZED=0
STARTED=''

# finish STATE ERROR: writes the final status (step done) and marks the run as reported.
finish() {
  local state="$1" error="${2:-}"
  write_update_status "$STATUS_FILE" "$state" "done" "$error" "$STARTED" "$(date +%s)" ||
    warn "Could not write the final update status."
  FINALIZED=1
}

cleanup() {
  local rc=$?
  rm -rf "$CONSUMED"
  if ((!FINALIZED)) && [[ -n "${STATUS_FILE:-}" && -n "$STARTED" ]]; then
    finish failed deploy
  fi
  return "$rc"
}

# parse_request FILE: sets REQ_ID, REQ_VERSION (valid ones only) and returns 1 if the content is
# anything other than the three expected lines. No eval, no source.
parse_request() {
  local file="$1" line key value
  local seen_id=0 seen_version=0 seen_requested=0 bad=0
  REQ_ID='' REQ_VERSION=''
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^([a-zA-Z]+)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}" value="${BASH_REMATCH[2]}"
    else
      bad=1
      continue
    fi
    case "$key" in
      id)
        if ((seen_id)); then bad=1; fi
        seen_id=1
        if [[ "$value" =~ ^[0-9a-f]{32}$ ]]; then REQ_ID="$value"; else bad=1; fi
        ;;
      version)
        if ((seen_version)); then bad=1; fi
        seen_version=1
        if [[ "$value" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then REQ_VERSION="$value"; else bad=1; fi
        ;;
      requestedAt)
        if ((seen_requested)); then bad=1; fi
        seen_requested=1
        [[ "$value" =~ ^[0-9]{1,12}$ ]] || bad=1
        ;;
      *) bad=1 ;;
    esac
  done <"$file"
  ((seen_id && seen_version && seen_requested && !bad))
}

rotate_log() {
  local log="$DEPLOY_DIR/update.log" f i=0
  if [[ -s "$log" ]]; then
    mv -f "$log" "$DEPLOY_DIR/update-$(date -u +%Y%m%dT%H%M%SZ)-$$.log"
  fi
  # Keep the five most recent rotated logs.
  while IFS= read -r f; do
    i=$((i + 1))
    if ((i > 5)); then rm -f "$f"; fi
  done < <(ls -1t "$DEPLOY_DIR"/update-*.log 2>/dev/null || true)
}

main() {
  init_env
  UPDATES_DIR="$EASYSEND_DIR/updates"
  REQUEST="$UPDATES_DIR/request"
  STATUS_FILE="$UPDATES_DIR/status.json"
  CONSUMED="$DEPLOY_DIR/update-request"

  # -L too: a dangling symlink is "not existing" for -e.
  if [[ ! -e "$REQUEST" && ! -L "$REQUEST" ]]; then
    exit 0
  fi
  # Out of the container's reach first, then look at it.
  rm -rf "$CONSUMED"
  mv -f "$REQUEST" "$CONSUMED" || die "Could not take the update request."
  trap cleanup EXIT

  STARTED="$(date +%s)"
  UPDATE_ID='' UPDATE_TARGET='' UPDATE_FROM=''

  if [[ -L "$CONSUMED" || ! -f "$CONSUMED" ]] || (($(wc -c <"$CONSUMED") > MAX_REQUEST_BYTES)); then
    finish failed invalid_request
    return 0
  fi
  local REQ_ID REQ_VERSION valid=1
  parse_request "$CONSUMED" || valid=0
  UPDATE_ID="$REQ_ID" UPDATE_TARGET="$REQ_VERSION"
  if ((!valid)); then
    # Keep the id and version only if they were individually valid.
    finish failed invalid_request
    return 0
  fi

  local current
  current="$(state_get current-version)"
  if [[ -z "$current" && -f "$EASYSEND_DIR/.env" ]]; then current="$(get_env_var APP_VERSION)"; fi
  normalize_version "$current" >/dev/null 2>&1 || current=''
  UPDATE_FROM="$current"

  if [[ -n "$current" && "$current" == "$UPDATE_TARGET" ]]; then
    finish succeeded already_current
    return 0
  fi

  write_update_status "$STATUS_FILE" running starting '' "$STARTED" '' || warn "Could not write the update status."
  rotate_log
  local deploy_cmd="${EASYSEND_DEPLOY_CMD:-$EASYSEND_DIR/scripts/deploy.sh}" rc=0
  # No exec and a fresh call: deploy.sh may replace the scripts on disk while it runs.
  EASYSEND_UPDATE_STATUS="$STATUS_FILE" EASYSEND_UPDATE_ID="$UPDATE_ID" EASYSEND_UPDATE_TARGET="$UPDATE_TARGET" \
    EASYSEND_UPDATE_FROM="$UPDATE_FROM" EASYSEND_UPDATE_STARTED="$STARTED" ASSUME_YES=1 \
    "$deploy_cmd" "$UPDATE_TARGET" --yes >>"$DEPLOY_DIR/update.log" 2>&1 || rc=$?

  case "$rc" in
    0) finish succeeded '' ;;
    "$EXIT_BUSY") finish failed busy ;;
    "$EXIT_COMPOSE") finish failed compose ;;
    "$EXIT_BACKUP") finish failed backup ;;
    "$EXIT_ROLLED_BACK") finish rolled_back deploy ;;
    "$EXIT_ROLLBACK_FAILED") finish failed rollback_failed ;;
    *) finish failed deploy ;;
  esac
}

main "$@"
