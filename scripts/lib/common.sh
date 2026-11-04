#!/usr/bin/env bash
# Shared helpers for the EasySend LXC scripts (deploy, rollback, backup, uninstall).
# Meant to be sourced, never executed.

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "This file is a library: source it from another script." >&2
  exit 1
fi

# --- Logging -----------------------------------------------------------------
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RED=$'\033[31m' C_GREEN=$'\033[32m' C_YELLOW=$'\033[33m' C_BLUE=$'\033[34m' C_RESET=$'\033[0m'
else
  C_RED='' C_GREEN='' C_YELLOW='' C_BLUE='' C_RESET=''
fi

log() { printf '%s[easysend]%s %s\n' "$C_BLUE" "$C_RESET" "$*"; }
ok() { printf '%s[ ok ]%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s[warn]%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
err() { printf '%s[fail]%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
die() {
  err "$*"
  exit 1
}

# Exit codes with a meaning for scripts/update-runner.sh (everything else is a plain 1):
#   0 ok, 75 another deploy/rollback holds the lock, 20 compose file step failed, 21 database
#   backup failed and 22 invalid DATA_PATH (all before any change to the running stack), 30 deploy
#   failed and the automatic rollback succeeded, 31 deploy failed and the rollback did not complete.
# shellcheck disable=SC2034 # used by the scripts that source this file
EXIT_BUSY=75 EXIT_COMPOSE=20 EXIT_BACKUP=21 EXIT_DATA_PATH=22 EXIT_ROLLED_BACK=30 EXIT_ROLLBACK_FAILED=31
# die_code CODE message...: like die, with a specific exit code.
die_code() {
  local code="$1"
  shift
  err "$*"
  exit "$code"
}

# --- Environment ---------------------------------------------------------------
# Sets EASYSEND_DIR (install dir), DEPLOY_DIR (state dir) and moves into the install dir.
# Compose must read APP_VERSION from .env, so a value inherited from the shell is dropped.
init_env() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[1]}")" && pwd)"
  EASYSEND_DIR="${EASYSEND_DIR:-$(cd "$script_dir/.." && pwd)}"
  DEPLOY_DIR="$EASYSEND_DIR/.deploy"
  GITHUB_REPO="${GITHUB_REPO:-ivanerricis/easysend}"
  ASSUME_YES="${ASSUME_YES:-0}"
  unset APP_VERSION
  [[ -d "$EASYSEND_DIR" ]] || die "Install directory not found: $EASYSEND_DIR"
  cd "$EASYSEND_DIR" || exit 1
  mkdir -p "$DEPLOY_DIR"
  chmod 700 "$DEPLOY_DIR"
}

# protected_install_prefix [DIR]: the one-click update service runs with ProtectHome=read-only and
# ProtectSystem=full, so an install dir under one of these trees is read-only for the runner.
# Prints the protected tree DIR (default: EASYSEND_DIR, symlinks resolved) is under and succeeds,
# or fails when DIR is usable. EASYSEND_PROTECTED_DIRS overrides the list (tests only).
protected_install_prefix() {
  local dir p
  dir="$(cd "${1:-$EASYSEND_DIR}" 2>/dev/null && pwd -P)" || dir="${1:-$EASYSEND_DIR}"
  for p in ${EASYSEND_PROTECTED_DIRS:-/home /root /run/user /usr /boot /efi /etc}; do
    if [[ "$dir" == "$p" || "$dir" == "$p"/* ]]; then
      printf '%s\n' "$p"
      return 0
    fi
  done
  return 1
}

# shellcheck disable=SC2034 # used by the scripts that source this file
INSTALL_DIR_DOCS="https://ivanerricis.github.io/easysend/guide/updates#move-the-installation-to-opt"

check_docker() {
  command -v docker >/dev/null 2>&1 || die "docker is not installed or not in PATH."
  docker compose version >/dev/null 2>&1 || die "The Docker Compose v2 plugin is missing (docker compose version failed)."
  docker info >/dev/null 2>&1 || die "Cannot talk to the Docker daemon: is it running, and is your user in the 'docker' group?"
}

check_env_file() {
  [[ -f "$EASYSEND_DIR/.env" ]] || die "$EASYSEND_DIR/.env not found: copy .env.example to .env first."
  grep -q '^APP_VERSION=' "$EASYSEND_DIR/.env" || die ".env has no APP_VERSION= line (see .env.example)."
}

# docker compose bound to the install dir (reads .env, COMPOSE_FILE and COMPOSE_PROFILES from there).
dc() { docker compose --project-directory "$EASYSEND_DIR" "$@"; }

# --- Interaction ---------------------------------------------------------------
# confirm "question": true with --yes; asks on a terminal; refuses to guess when non-interactive.
confirm() {
  if [[ "$ASSUME_YES" == "1" ]]; then return 0; fi
  [[ -t 0 ]] || die "Confirmation needed but stdin is not a terminal: pass --yes."
  local answer
  read -r -p "$1 [y/N] " answer
  [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]
}

# --- Versions ------------------------------------------------------------------
# normalize_version "v0.1.0" -> "0.1.0"; fails on anything that is not semver.
normalize_version() {
  local v="${1#v}"
  [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || return 1
  printf '%s\n' "$v"
}

# parse_tag_name: reads a GitHub "latest release" JSON payload on stdin, prints the tag_name value.
parse_tag_name() {
  grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | sed 's/.*:[[:space:]]*"\([^"]*\)"/\1/'
}

# --- .env ----------------------------------------------------------------------
get_env_var() {
  local value
  value="$(sed -n "s/^$1=//p" "$EASYSEND_DIR/.env" | tail -n 1)"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s\n' "$value"
}

# set_env_var KEY VALUE: atomic rewrite (temp file + mv), keeps permissions and the other lines.
set_env_var() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp "$EASYSEND_DIR/.env.XXXXXX")"
  cp -p "$EASYSEND_DIR/.env" "$tmp"
  if grep -q "^$key=" "$EASYSEND_DIR/.env"; then
    sed "s|^$key=.*|$key=$value|" "$EASYSEND_DIR/.env" >"$tmp"
  else
    { cat "$EASYSEND_DIR/.env"; printf '%s=%s\n' "$key" "$value"; } >"$tmp"
  fi
  mv "$tmp" "$EASYSEND_DIR/.env"
}

# --- State (.deploy/) ------------------------------------------------------------
state_get() {
  if [[ -f "$DEPLOY_DIR/$1" ]]; then tr -d '[:space:]' <"$DEPLOY_DIR/$1"; fi
}
state_set() { printf '%s\n' "$2" >"$DEPLOY_DIR/$1.tmp" && mv "$DEPLOY_DIR/$1.tmp" "$DEPLOY_DIR/$1"; }
history_add() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$DEPLOY_DIR/history.log"; }

# Single running instance of the state-changing scripts (flock is part of util-linux on Debian).
acquire_lock() {
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$DEPLOY_DIR/lock"
    flock -n 9 || die_code "$EXIT_BUSY" "Another deploy/rollback is already running."
  fi
}

# --- Compose / app ---------------------------------------------------------------
api_running() {
  [[ -n "$(dc ps --status running -q api 2>/dev/null)" ]]
}

# Waits for /health (through nginx, inside the web container) to report ok, and, when given,
# the expected version. Usage: wait_healthy [expected-version] [attempts]
wait_healthy() {
  local expected="${1:-}" attempts="${2:-30}" body='' i
  for ((i = 1; i <= attempts; i++)); do
    body="$(dc exec -T web wget -qO- http://127.0.0.1:8080/health 2>/dev/null || true)"
    if grep -q '"status":"ok"' <<<"$body" && grep -q '"db":"ok"' <<<"$body"; then
      if [[ -z "$expected" ]] || grep -qF "\"version\":\"$expected\"" <<<"$body"; then
        return 0
      fi
    fi
    sleep 2
  done
  warn "Last /health response: ${body:-<none>}"
  return 1
}

# Creates a DB backup with the api CLI and prints only its file name.
# Uses the running api, or a one-off container (no other writer then) when it is stopped.
db_backup() {
  local errfile name rc=0
  errfile="$(mktemp)"
  if api_running; then
    name="$(dc exec -T api node dist/cli/backup-db.js 2>"$errfile")" || rc=$?
  else
    name="$(dc run --rm --no-deps -T api node dist/cli/backup-db.js 2>"$errfile")" || rc=$?
  fi
  if ((rc != 0)); then
    err "Database backup failed: $(tail -n 3 "$errfile" | tr '\n' ' ')"
    rm -f "$errfile"
    return 1
  fi
  rm -f "$errfile"
  name="$(tail -n 1 <<<"$name" | tr -d '[:space:]')"
  [[ "$name" =~ ^manual-[0-9TZ]+\.sqlite$ ]] || {
    err "Unexpected backup CLI output: $name"
    return 1
  }
  printf '%s\n' "$name"
}

# Name of the Compose project and the real name of a declared volume.
compose_project_name() { dc config 2>/dev/null | sed -n 's/^name: //p' | head -n 1; }
volume_real_name() {
  local project vol
  project="$(compose_project_name)"
  vol="$(docker volume ls -q \
    --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.volume=$1" | head -n 1)"
  printf '%s\n' "${vol:-${project}_$1}"
}

# --- Data location (optional DATA_PATH in .env) ----------------------------------
# DATA_PATH is a host folder bind-mounted at /data in the api container instead of the named
# volume easysend-data. The api runs as uid/gid 1000 (EASYSEND_DATA_UID/GID override it in tests).

# data_path: the configured host folder, empty for the default Docker volume.
data_path() {
  [[ -f "$EASYSEND_DIR/.env" ]] || return 0
  get_env_var DATA_PATH
}

# data_mount_source: what to pass to `docker run -v <source>:/data`: DATA_PATH when set,
# otherwise the real name of the easysend-data volume.
data_mount_source() {
  local p
  p="$(data_path)"
  if [[ -n "$p" ]]; then printf '%s\n' "$p"; else volume_real_name easysend-data; fi
}

# check_data_path: succeeds silently without DATA_PATH; otherwise requires an absolute path
# (no ':' or trailing slash, which would break the mount spec) to an existing directory the
# api user (uid/gid 1000) can write to. Prints the reason on stderr and returns 1 otherwise.
check_data_path() {
  local p uid gid
  p="$(data_path)"
  [[ -n "$p" ]] || return 0
  uid="${EASYSEND_DATA_UID:-1000}" gid="${EASYSEND_DATA_GID:-1000}"
  if [[ "$p" != /* ]]; then err "DATA_PATH must be an absolute path (got '$p')."; return 1; fi
  if [[ "$p" == *:* || "$p" == *[[:cntrl:]]* ]]; then err "DATA_PATH must not contain ':' or control characters (got '$p')."; return 1; fi
  if [[ "$p" == / ]]; then err "DATA_PATH cannot be the filesystem root."; return 1; fi
  if [[ "$p" == */ ]]; then err "DATA_PATH must not end with a slash (got '$p')."; return 1; fi
  if [[ ! -e "$p" ]]; then err "DATA_PATH '$p' does not exist. Create it with: sudo install -d -o $uid -g $gid $p"; return 1; fi
  if [[ ! -d "$p" ]]; then err "DATA_PATH '$p' is not a directory."; return 1; fi
  local owner group mode writable=0
  read -r owner group mode < <(stat -c '%u %g %a' "$p") || { err "Cannot stat DATA_PATH '$p'."; return 1; }
  mode=$((8#$mode))
  if ((owner == uid && (mode & 0300) == 0300)); then
    writable=1
  elif ((group == gid && (mode & 0030) == 0030)); then
    writable=1
  elif (((mode & 0003) == 0003)); then
    writable=1
  fi
  if ((!writable)); then
    err "DATA_PATH '$p' (owner $owner:$group, mode $(printf '%o' "$mode")) is not writable by uid $uid. Fix with: sudo chown $uid:$gid $p && sudo chmod 750 $p"
    return 1
  fi
}

# compose_supports_data_path FILE: true when the compose file mounts DATA_PATH (releases before
# this feature ignore it and would silently start on an empty named volume).
compose_supports_data_path() { grep -q 'DATA_PATH' "$1" 2>/dev/null; }

# --- Scripts self-update -------------------------------------------------------------
# Files of the install dir that deploy.sh keeps in sync with the deployed release.
SCRIPT_FILES=(scripts/deploy.sh scripts/rollback.sh scripts/backup.sh scripts/uninstall.sh scripts/update-runner.sh scripts/update-service.sh scripts/lib/common.sh)

# Base URL of the raw repository files (overridable for forks and tests).
raw_base() { printf '%s\n' "${EASYSEND_RAW_BASE:-https://raw.githubusercontent.com/$GITHUB_REPO}"; }

# True when downloads from the release are disabled (old name kept for compatibility).
downloads_skipped() {
  [[ "${EASYSEND_SKIP_DOWNLOADS:-0}" == "1" || "${EASYSEND_SKIP_COMPOSE_DOWNLOAD:-0}" == "1" ]]
}

# install_file SRC DST MODE: copies next to DST then renames over it. A bash process that is
# still reading the old file keeps its old inode, so replacing a running script is safe.
install_file() {
  local src="$1" dst="$2" mode="$3" tmp
  mkdir -p "$(dirname "$dst")"
  tmp="$(mktemp "$dst.XXXXXX")"
  cp "$src" "$tmp"
  chmod "$mode" "$tmp"
  mv -f "$tmp" "$dst"
}

# script_mode FILE: 755 for the executables, 644 for the library.
script_mode() { if [[ "$1" == scripts/lib/* ]]; then echo 644; else echo 755; fi; }

# snapshot_scripts DIR: copies the current script files into DIR (same relative layout).
snapshot_scripts() {
  local dir="$1" f
  rm -rf "$dir"
  for f in "${SCRIPT_FILES[@]}"; do
    mkdir -p "$dir/$(dirname "$f")"
    cp -p "$EASYSEND_DIR/$f" "$dir/$f"
  done
}

# install_scripts_from DIR: atomically puts every script file found in DIR in place.
install_scripts_from() {
  local dir="$1" f
  for f in "${SCRIPT_FILES[@]}"; do
    [[ -f "$dir/$f" ]] || continue
    install_file "$dir/$f" "$EASYSEND_DIR/$f" "$(script_mode "$f")"
  done
}

# --- Update status (one-click update from the admin panel) --------------------------------
# status.json lives in $EASYSEND_DIR/updates/, which the api container can also write: it is
# always replaced by rename (never written through), so a planted symlink is overwritten, not followed.
# JSON is built only from values validated here (hex id, semver, fixed words, integers): no escaping.
UPDATE_STATES='running succeeded rolled_back failed'
UPDATE_STEPS='starting compose backup pull restart health rollback done'
UPDATE_ERRORS='busy invalid_request already_current compose backup deploy rollback_failed'

_in_words() { [[ " $2 " == *" $1 "* ]]; }
_json_str() { if [[ -n "$1" ]]; then printf '"%s"' "$1"; else printf 'null'; fi; }

# write_update_status DEST STATE STEP ERROR STARTED FINISHED
# Reads UPDATE_ID, UPDATE_TARGET and UPDATE_FROM from the caller's variables; empty means null.
# Returns 1 (writing nothing) when a value is not valid.
write_update_status() {
  local dest="$1" state="$2" step="$3" error="${4:-}" started="${5:-}" finished="${6:-}" now tmp
  local id="${UPDATE_ID:-}" target="${UPDATE_TARGET:-}" from="${UPDATE_FROM:-}"
  local semver='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
  [[ -z "$id" || "$id" =~ ^[0-9a-f]{32}$ ]] || return 1
  [[ -z "$target" || "$target" =~ $semver ]] || return 1
  [[ -z "$from" || "$from" =~ $semver ]] || return 1
  _in_words "$state" "$UPDATE_STATES" || return 1
  _in_words "$step" "$UPDATE_STEPS" || return 1
  [[ -z "$error" ]] || _in_words "$error" "$UPDATE_ERRORS" || return 1
  [[ -z "$finished" || "$finished" =~ ^[0-9]{1,12}$ ]] || return 1
  now="$(date +%s)"
  [[ -n "$started" ]] || started="$now"
  [[ "$started" =~ ^[0-9]{1,12}$ ]] || return 1
  tmp="$(mktemp "$(dirname "$dest")/.status.XXXXXX")" || return 1
  printf '{"id":%s,"targetVersion":%s,"fromVersion":%s,"state":"%s","step":"%s","error":%s,"startedAt":%s,"updatedAt":%s,"finishedAt":%s}\n' \
    "$(_json_str "$id")" "$(_json_str "$target")" "$(_json_str "$from")" "$state" "$step" "$(_json_str "$error")" \
    "$started" "$now" "${finished:-null}" >"$tmp" || { rm -f "$tmp"; return 1; }
  if ! { chmod 644 "$tmp" && mv -f "$tmp" "$dest"; }; then
    rm -f "$tmp"
    return 1
  fi
}

# update_step STEP: progress marker for the one-click update. A no-op unless the runner set
# EASYSEND_UPDATE_STATUS (so manual deploys behave exactly as before); never fails the caller.
update_step() {
  [[ -n "${EASYSEND_UPDATE_STATUS:-}" ]] || return 0
  local UPDATE_ID="${EASYSEND_UPDATE_ID:-}" UPDATE_TARGET="${EASYSEND_UPDATE_TARGET:-}" UPDATE_FROM="${EASYSEND_UPDATE_FROM:-}"
  write_update_status "$EASYSEND_UPDATE_STATUS" running "$1" '' "${EASYSEND_UPDATE_STARTED:-}" '' ||
    warn "Could not write the update status (step $1)."
  return 0
}
