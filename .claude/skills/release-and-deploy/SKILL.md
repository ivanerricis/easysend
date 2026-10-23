---
name: release-and-deploy
description: Ship an EasySend release - check the release-please PR, approve its pending CI, verify tag, GitHub Release and GHCR images after the user merges, then guide the deploy on the Proxmox LXC with scripts/deploy.sh. Use when the user wants to release or update production.
---

# Release and deploy (EasySend)

Versions come from Conventional Commits via release-please (type `simple`; in 0.x `feat` bumps the
minor, `fix` the patch; 1.0.0 is the user's call). The user merges; Claude never merges to `main`.
`gh` needs the WinGet path in Git Bash (see the handoff memory) and network commands may need the
sandbox disabled.

## 1. Release PR

1. Find the open PR `chore(main): release X.Y.Z` (`gh pr list -R ivanerricis/easysend`).
2. Check the diff: `.release-please-manifest.json`, root `package.json` version and `CHANGELOG.md`
   show the expected version. Breaking changes in 0.x must bump the minor.
3. Its CI runs are created by `GITHUB_TOKEN`, so they wait as "action required". Approve them:
   `gh api "repos/ivanerricis/easysend/actions/runs?head_sha=<sha>"` to list them, then
   `gh api -X POST repos/ivanerricis/easysend/actions/runs/<id>/approve` for CI and Security.
   No bypass, no PAT.
4. Wait for all checks green, then tell the user the PR is ready for their squash merge.

## 2. After the merge

1. `gh release view vX.Y.Z` exists with the changelog.
2. The "Release Please" run on `main` has `release-please` and `publish / publish (api|web|cloudflared)`
   green (`gh run view <id> --json jobs`).
3. Images are pullable anonymously (the LXC never logs in):
   `curl -s "https://ghcr.io/token?scope=repository:ivanerricis/easysend-api:pull"` for a token, then
   `GET https://ghcr.io/v2/ivanerricis/easysend-api/manifests/X.Y.Z` with the OCI accept headers must
   answer 200. Repeat for `web` and `cloudflared`, and for the `X.Y` and `latest` tags. If 401/403,
   the package is private: the user must make it public in the GitHub package settings (no API).
4. The release files are downloadable from the tag:
   `https://raw.githubusercontent.com/ivanerricis/easysend/vX.Y.Z/{docker-compose.yml,scripts/deploy.sh,...}`.
5. Update local `main` and delete merged branches.

## 3. Deploy on the LXC (the user runs it; Claude guides)

Docs: https://ivanerricis.github.io/easysend/it/guide/updates (install: `/it/guide/install`).

```sh
cd /opt/easysend
./scripts/deploy.sh X.Y.Z      # or no argument for the latest release
```

`deploy.sh` backs up the DB, downloads the tag's compose file, pulls, updates `APP_VERSION`,
starts with `--wait`, checks `/health` reports the new version, rolls back automatically on failure
and then updates the scripts themselves (previous copies in `.deploy/previous-scripts/`).
The same deploy can be started from the admin panel (Settings → Updates → choose a version → Update
now) when the host runner is installed: `sudo ./scripts/update-service.sh install [--user U]` once
(check with `sudo ./scripts/update-service.sh status`; `uninstall` removes it). The panel writes
`updates/request`, the systemd unit `easysend-update.path` starts `scripts/update-runner.sh`, which
runs `deploy.sh <version> --yes` (log `.deploy/update.log`, `journalctl -u easysend-update.service`;
the lock is shared with manual deploys). Upgrading an install that is on 0.1.x: after deploying 0.2.0
the user must fetch `update-runner.sh` and `update-service.sh` once by hand, see the guide section
"One-click update" (`/it/guide/updates#aggiornamento-con-un-clic`). `bash scripts/tests/run.sh`
tests these scripts.
Problems: read `.deploy/history.log` and `docker compose logs api`. Manual rollback:
`./scripts/rollback.sh` (restores DB and scripts) or `--keep-db`. A backup archive:
`./scripts/backup.sh` (contains the master key: store it offline).

## Never

Merge PRs, force-push, edit the ruleset without asking, print or store tokens.
