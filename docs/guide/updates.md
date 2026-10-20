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
