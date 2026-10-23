# Updating, deploy and rollback

Release notes are on [GitHub Releases](https://github.com/ivanerricis/easysend/releases). To update:

```sh
cd /opt/easysend
./scripts/deploy.sh            # latest release
./scripts/deploy.sh 0.2.0      # a specific one
```

What `deploy.sh [version] [--force] [--yes]` does:

1. checks Docker, Compose, curl and `.env`, and remembers the current version in `.deploy/`;
2. downloads and validates the `docker-compose.yml` of the release tag;
3. backs up the database (if the stack is running);
4. pulls the images, updates `APP_VERSION`, runs `docker compose up -d --wait`;
5. checks `/health` and that it reports the new version.

If anything fails after the switch, the previous version, compose file and database are restored automatically. The history is in `.deploy/history.log`.

## Rollback

To go back to the previous version by hand:

```sh
./scripts/rollback.sh              # also restores the database taken before the last deploy
./scripts/rollback.sh --keep-db    # keep the current database
```

Restoring the database discards everything written since that deploy (the current database is saved first as `app-pre-restore-<time>.sqlite`). With `--keep-db` the data stays, but an older version may not understand a database already migrated by a newer one. Old images stay on disk so rollbacks are quick; free the space with `docker image prune -a` when you no longer need them.

::: warning 0.x releases
In 0.x, releases that change the minor number can contain breaking changes. Read the release notes first.
:::

## One-click update

Instead of running `deploy.sh` over SSH, an admin can update from **Settings → Updates**. It is optional: until you install the runner below, the panel only shows the commands to run by hand.

What it does and does not do:

- the container never gets the Docker socket and never runs commands on the host. The API only writes a small request file in a shared folder (`/opt/easysend/updates/`); a systemd unit **on the LXC** notices it and runs the same `scripts/deploy.sh` you would run by hand;
- only an official release can be installed: a published (not draft, not pre-release) `X.Y.Z` release of the GitHub repository that is newer than the running version. The server checks it against GitHub again when you start the update;
- backup, health check and automatic rollback are those of `deploy.sh` (see above). The panel and a manual deploy share the same lock, so they never run at the same time.

### Install the runner

Once, as root, on the LXC (the install directory must be under `/opt`, not under `/home`):

```sh
cd /opt/easysend
sudo ./scripts/update-service.sh install              # runs updates as the owner of /opt/easysend
sudo ./scripts/update-service.sh install --user ivan  # or as another user
```

The account that runs the updates must be `root` or in the `docker` group. The command creates `updates/` (owned by uid 1000, the user the API runs as, with the runner user's group, mode `2770`), writes `updates/runner.json` and the units `easysend-update.path` and `easysend-update.service`, and enables the path unit. It is safe to run again. Check it with `sudo ./scripts/update-service.sh status`.

::: warning Upgrading from 0.1.x
`deploy.sh` of 0.1.x only knows the old scripts, so after `./scripts/deploy.sh 0.2.0` the two new ones are missing. Fetch them once (from 0.2.0 on, `deploy.sh` keeps them updated):

```sh
cd /opt/easysend
for f in update-runner.sh update-service.sh; do
  curl -fsSL "https://raw.githubusercontent.com/ivanerricis/easysend/v0.2.0/scripts/$f" -o "scripts/$f"
done
chmod +x scripts/update-runner.sh scripts/update-service.sh
sudo ./scripts/update-service.sh install
```

The old `deploy.sh` also does not create `updates/`, so Docker may have created it owned by root: `install` fixes the ownership.
:::

### Use it

1. Open **Settings → Updates**. The list shows the releases newer than the running one (up to 30).
2. Choose a version, press **Update now** and confirm in the dialog.
3. The panel shows the live progress. It keeps working while the stack restarts and picks the status up again when the API is back.

The steps are: starting, compose file, database backup, pulling images, restart, health check and, only on failure, rollback.

### Outcomes

- **Updated**: the new version is running; the panel offers to reload the page.
- **Rolled back**: the new version did not start and the previous version and database were restored automatically.
- **Failed**: the update stopped, with the reason (for example another deploy was running, the compose file was invalid, the backup failed, or the rollback itself failed). The message names the log file, `.deploy/update.log`.

A request that the runner does not pick up within 2 minutes is shown as "not responding" and does not block a new one. A run shown as running but not updated for 45 minutes no longer blocks either. There is no rollback button in the panel: use `./scripts/rollback.sh` on the server.

### Logs and troubleshooting

- `/opt/easysend/.deploy/update.log` is the output of the last update (the five previous ones are kept as `update-<time>.log`); `.deploy/history.log` has the summary.
- `journalctl -u easysend-update.service` shows the runner itself.
- **"Not responding"**, or the request never starts: `systemctl status easysend-update.path` must be `active (waiting)`. If it is not, run `sudo ./scripts/update-service.sh status` and `install` again.
- **"User is not in the docker group"**: `sudo usermod -aG docker <user>`, or pass `--user`.
- **The panel says the runner is not installed**: `updates/runner.json` is missing; run `install`.
- **The update fails with permission errors on the status file**: the install directory is probably under `/home`. The service runs with `ProtectHome=read-only`; move the installation to `/opt/easysend`.

### Remove it

```sh
sudo ./scripts/update-service.sh uninstall
```

This removes the units and `runner.json` and keeps `updates/`. [`uninstall.sh`](./uninstall) removes the units too (as root; otherwise it prints the command).

## Update notice in the admin panel

When a newer release exists, admins see a notice in the sidebar and the **Settings → Updates** section shows the current version, the list of newer releases with their release notes, and either the **Update now** button (if the [one-click update](#one-click-update) is installed) or the exact commands to run on the server.

To know about new releases the server asks GitHub for the latest published release: only when an admin opens the panel, at most once a day (the answer is kept in memory for 24 hours). The request has no body and no cookies; GitHub only sees the server's IP address and the `User-Agent` header with the running version. No data about your instance is sent. Turn the check off in **Settings → General → Check for updates**.
