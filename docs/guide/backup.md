# Backup and restore

What to keep:

| What                       | Where                              |
| -------------------------- | ---------------------------------- |
| Database                   | `easysend-data` volume             |
| Encrypted files            | `easysend-data` volume             |
| Logos, favicon, background | `easysend-data` volume             |
| Master key, session secret | `easysend-data` volume, `secrets/` |
| Configuration              | `.env`, `docker-compose.yml`       |

## Backup

```sh
./scripts/backup.sh            # writes to /opt/easysend/backups
./scripts/backup.sh /mnt/usb   # or to another directory
```

It takes a consistent database backup through the api's backup CLI (never a copy of the live file), then writes `easysend-backup-<UTC time>.tar.gz` with mode 600 containing the database backup, `storage/`, `branding/`, `secrets/`, `.env` and `docker-compose.yml`.

::: warning The archive contains the master key
Whoever has the archive can decrypt every file. Store it encrypted or offline, and copy it off the LXC. Without the master key (`APP_SECRET_KEY` or `/data/secrets/app.key`) the files, the TOTP secrets and the SMTP password are unreadable, even with the rest of the data intact.
:::

## Restore

Restore on a clean or broken installation (same or newer version). The same steps are printed by `./scripts/backup.sh --help`.

```sh
# 1. recreate the install directory with .env, docker-compose.yml and scripts/ from the release
mkdir /opt/easysend && cd /opt/easysend
tar xzf <archive> .env docker-compose.yml
chmod 600 .env
#    (download scripts/ from the release as in the Installation page)

# 2. create the empty volumes
docker compose create

# 3. copy the data into the volume (<project> is the Compose project name,
#    by default the install directory name: see `docker volume ls`)
docker run --rm -i -v <project>_easysend-data:/data alpine:3.24.2 \
  sh -c 'tar xzf - -C /tmp data && cp -a /tmp/data/. /data/' < <archive>

# 4. restore the database (file name from: tar tzf <archive> | grep sqlite)
docker compose run --rm --no-deps api node dist/cli/restore-db.js manual-<timestamp>.sqlite

# 5. start
docker compose up -d
```

Test a restore on a spare machine now and then: a backup you never restored is only a hope.
