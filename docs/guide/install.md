# Installation

The images are public on GHCR: `ghcr.io/ivanerricis/easysend-api`, `-web` and `-cloudflared`. No registry login is needed. The version in use is pinned in `.env` as `APP_VERSION` (never `latest`).

```sh
sudo mkdir -p /opt/easysend && sudo chown "$USER": /opt/easysend
cd /opt/easysend
V=0.1.0   # the release you want
RAW=https://raw.githubusercontent.com/ivanerricis/easysend/v$V
mkdir -p scripts/lib
curl -fsSL -o docker-compose.yml $RAW/docker-compose.yml
curl -fsSL -o .env.example $RAW/.env.example
for f in deploy.sh rollback.sh backup.sh uninstall.sh lib/common.sh; do
  curl -fsSL -o scripts/$f $RAW/scripts/$f
done
chmod +x scripts/*.sh
cp .env.example .env
chmod 600 .env
./scripts/deploy.sh          # latest release
# or: ./scripts/deploy.sh 0.1.0
```

`deploy.sh` writes `APP_VERSION` into `.env`, pulls the images and starts the stack. Forks or private registries can set `IMAGE_PREFIX` in `.env` (default `ghcr.io/ivanerricis/easysend`).

`.env.example` already sets `COMPOSE_FILE=docker-compose.yml` and `COMPOSE_PROFILES=tunnel`. Everything else configured in the wizard or admin panel is stored in the database, not in `.env`.

To update from the admin panel (release 0.2.0 or later) also fetch `update-runner.sh` and `update-service.sh` into `scripts/` the same way and run `sudo ./scripts/update-service.sh install`: see [One-click update](./updates#one-click-update).

Next: [First setup (wizard)](./first-setup).
