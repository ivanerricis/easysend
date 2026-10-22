#!/usr/bin/env bash
# Installs, removes or inspects the systemd units behind the one-click update of the admin panel.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

PATH_UNIT=easysend-update.path
SERVICE_UNIT=easysend-update.service

usage() {
  cat <<'EOF2'
Usage: scripts/update-service.sh install|uninstall|status [--user USER]

install    (root) creates updates/ (shared with the api container), writes updates/runner.json and the
           units easysend-update.path / easysend-update.service, then enables the path unit. The path
           unit watches updates/request, which the admin panel writes to ask for an update; the service
           runs scripts/update-runner.sh as USER (it needs Docker access). Safe to run again.
uninstall  (root) disables and removes the units and updates/runner.json (updates/ is kept).
status     shows the units, runner.json and the last update status.

--user USER  account that runs the updates (default: owner of the install directory). It must be
             root or in the 'docker' group.

Environment: EASYSEND_DIR (default: parent of scripts/), EASYSEND_SYSTEMD_DIR (default:
/etc/systemd/system), EASYSEND_SKIP_SYSTEMCTL=1 (do not call systemctl: for tests).
EOF2
}

skip_systemctl() { [[ "${EASYSEND_SKIP_SYSTEMCTL:-0}" == "1" ]]; }
need_root() { [[ "$(id -u)" == "0" ]] || die "Run this command as root (sudo scripts/update-service.sh $1)."; }

systemd_dir() { printf '%s\n' "${EASYSEND_SYSTEMD_DIR:-/etc/systemd/system}"; }

do_install() {
  need_root install
  if ! skip_systemctl; then command -v systemctl >/dev/null 2>&1 || die "systemctl not found: systemd is required."; fi
  local user="$1" group sdir updates
  id "$user" >/dev/null 2>&1 || die "User not found: $user"
  if [[ "$user" != root ]] && ! id -nG "$user" | tr ' ' '\n' | grep -qx docker; then
    die "User $user is not in the 'docker' group: add it (usermod -aG docker $user) or pass --user."
  fi
  group="$(id -gn "$user")"
  sdir="$(systemd_dir)"
  updates="$EASYSEND_DIR/updates"

  mkdir -p "$updates" "$sdir"
  # uid 1000 is the user the api runs as inside the container; the group lets the runner user read it.
  chown "1000:$group" "$updates"
  chmod 2770 "$updates"

  local tmp
  tmp="$(mktemp "$updates/.runner.XXXXXX")"
  printf '{"version":1,"installedAt":%s}\n' "$(date +%s)" >"$tmp"
  chmod 644 "$tmp"
  chown "$user:$group" "$tmp"
  mv -f "$tmp" "$updates/runner.json"

  cat >"$sdir/$PATH_UNIT" <<UNIT
[Unit]
Description=Watch for EasySend update requests

[Path]
PathExists=$updates/request
Unit=$SERVICE_UNIT

[Install]
WantedBy=paths.target
UNIT
  cat >"$sdir/$SERVICE_UNIT" <<UNIT
[Unit]
Description=Run the EasySend update requested from the admin panel
After=docker.service

[Service]
Type=oneshot
User=$user
Group=$group
WorkingDirectory=$EASYSEND_DIR
Environment=EASYSEND_DIR=$EASYSEND_DIR
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$EASYSEND_DIR/scripts/update-runner.sh
TimeoutStartSec=45min
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectHome=read-only
UNIT
  chmod 644 "$sdir/$PATH_UNIT" "$sdir/$SERVICE_UNIT"

  if ! skip_systemctl; then
    systemctl daemon-reload
    systemctl enable --now "$PATH_UNIT"
  fi
  ok "One-click update installed (runner user: $user)."
  log "Check: systemctl status $PATH_UNIT"
  log "Logs:  journalctl -u $SERVICE_UNIT   and   $EASYSEND_DIR/.deploy/update.log"
}

do_uninstall() {
  need_root uninstall
  local sdir
  sdir="$(systemd_dir)"
  if ! skip_systemctl; then
    systemctl disable --now "$PATH_UNIT" 2>/dev/null || true
  fi
  rm -f "$sdir/$PATH_UNIT" "$sdir/$SERVICE_UNIT"
  if ! skip_systemctl; then systemctl daemon-reload; fi
  rm -f "$EASYSEND_DIR/updates/runner.json"
  ok "One-click update removed (updates/ kept)."
}

do_status() {
  local sdir u
  sdir="$(systemd_dir)"
  for u in "$PATH_UNIT" "$SERVICE_UNIT"; do
    if [[ -f "$sdir/$u" ]]; then
      if ! skip_systemctl && command -v systemctl >/dev/null 2>&1; then
        log "$u: installed, $(systemctl is-active "$u" 2>/dev/null || true)"
      else
        log "$u: installed"
      fi
    else
      log "$u: not installed"
    fi
  done
  if [[ -f "$EASYSEND_DIR/updates/runner.json" ]]; then log "runner.json: present"; else log "runner.json: missing"; fi
  if [[ -f "$EASYSEND_DIR/updates/status.json" ]]; then
    log "last update: $(cat "$EASYSEND_DIR/updates/status.json")"
  else
    log "last update: none"
  fi
}

main() {
  local cmd='' user=''
  while (($#)); do
    case "$1" in
      -h | --help) usage; exit 0 ;;
      install | uninstall | status) [[ -z "$cmd" ]] || die "Only one command can be given."; cmd="$1" ;;
      --user) shift; [[ $# -gt 0 ]] || die "--user needs a value."; user="$1" ;;
      *) usage >&2; die "Unknown argument: $1" ;;
    esac
    shift
  done
  [[ -n "$cmd" ]] || { usage >&2; exit 1; }

  EASYSEND_DIR="${EASYSEND_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
  [[ -d "$EASYSEND_DIR" ]] || die "Install directory not found: $EASYSEND_DIR"
  if [[ -z "$user" ]]; then user="$(stat -c %U "$EASYSEND_DIR")"; fi

  case "$cmd" in
    install) do_install "$user" ;;
    uninstall) do_uninstall ;;
    status) do_status ;;
  esac
}

main "$@"
