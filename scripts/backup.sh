#!/usr/bin/env bash
# Creates a full, consistent backup archive of an EasySend installation.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

HELPER_IMAGE='alpine:3.24.2'

usage() {
  cat <<'USAGE'
Usage: scripts/backup.sh [DEST_DIR]

Writes DEST_DIR/easysend-backup-<UTC timestamp>.tar.gz (default DEST_DIR: <install dir>/backups,
mode 700; the archive is mode 600) containing:
  data/db/backups/manual-<ts>.sqlite   a consistent database backup made just now by the api CLI
                                       (never a hot copy of the live database)
  data/storage/                        encrypted files
  data/branding/                       logos, favicon, background
  data/secrets/                        master key and session secret
  .env, docker-compose.yml             deployment configuration
If the api is stopped, a one-off container takes the database backup instead.

WARNING: the archive contains the MASTER KEY (data/secrets and .env). Whoever has it together
with the archive can decrypt every file. Store it encrypted or offline, never in a shared place.

Restore procedure (on a clean or broken installation, same or newer version):
  1. mkdir /opt/easysend && cd /opt/easysend
     tar xzf <archive> .env docker-compose.yml   (plus scripts/ from the release); chmod 600 .env
  2. docker compose create          # creates the empty volumes
  3. restore the volume content (<project> = Compose project name, by default the install
     directory name; see `docker volume ls`):
       docker run --rm -i -v <project>_easysend-data:/data alpine:3.24.2 \
         sh -c 'tar xzf - -C /tmp data && cp -a /tmp/data/. /data/' < <archive>
  4. docker compose run --rm --no-deps api node dist/cli/restore-db.js manual-<ts>.sqlite
     (the file name is shown by: tar tzf <archive> | grep sqlite)
  5. docker compose up -d

Environment: EASYSEND_DIR.
USAGE
}

main() {
  local dest=''
  while (($#)); do
    case "$1" in
      -h | --help) usage; exit 0 ;;
      -*) usage >&2; die "Unknown option: $1" ;;
      *) [[ -z "$dest" ]] || die "Only one destination directory can be given."; dest="$1" ;;
    esac
    shift
  done

  init_env
  check_docker
  check_env_file
  [[ -n "$(get_env_var APP_VERSION)" ]] || die "APP_VERSION is empty in .env: nothing deployed to back up."
  dest="${dest:-$EASYSEND_DIR/backups}"
  mkdir -p "$dest"
  chmod 700 "$dest"
  dest="$(cd "$dest" && pwd)"

  log "Creating a consistent database backup..."
  local db_name
  db_name="$(db_backup)" || die "Backup aborted."
  ok "Database backup: $db_name"

  local volume ts archive partial
  volume="$(volume_real_name easysend-data)"
  docker volume inspect "$volume" >/dev/null 2>&1 || die "Data volume '$volume' not found."
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  archive="$dest/easysend-backup-$ts.tar.gz"
  partial="$archive.partial"
  trap 'rm -f "$partial"' EXIT

  log "Archiving from volume $volume (helper image $HELPER_IMAGE)..."
  # The host config files travel on stdin; the container links the volume content next to them
  # and streams one gzip'd tar to stdout, which lands directly in the archive file.
  (
    umask 077
    tar -cf - -C "$EASYSEND_DIR" .env docker-compose.yml |
      docker run --rm -i --network none -e "DB_NAME=$db_name" -v "$volume:/data:ro" "$HELPER_IMAGE" sh -ec '
        mkdir -p /stage/data/db/backups
        tar -xf - -C /stage
        for d in storage branding secrets; do
          if [ -e "/data/$d" ]; then ln -s "/data/$d" "/stage/data/$d"; fi
        done
        ln -s "/data/db/backups/$DB_NAME" "/stage/data/db/backups/$DB_NAME"
        tar -chzf - -C /stage .
      ' >"$partial"
  ) || die "Archiving failed."
  chmod 600 "$partial"
  local listing
  listing="$(tar -tzf "$partial")" || die "The archive is not a valid tar.gz."
  grep -qF "data/db/backups/$db_name" <<<"$listing" || die "The archive does not contain the database backup."
  mv "$partial" "$archive"
  trap - EXIT

  history_add "backup $archive db=$db_name"
  ok "Backup written: $archive ($(du -h "$archive" | cut -f1))"
  warn "This archive contains the MASTER KEY and .env: store it encrypted/offline and never share it."
}

main "$@"
