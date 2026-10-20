# EasySend

English | [Italiano](README.it.md)

EasySend is a self-hosted web application for sending large files, similar to WeTransfer. You run it on your own server, behind a Cloudflare Tunnel, so no inbound port is opened.

![New transfer page](docs/screenshots/06-new-transfer-light.png)

| Download page                                                     | Admin: users                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------- |
| ![Download page](docs/screenshots/11-download-unlocked-light.png) | ![Admin users](docs/screenshots/13-admin-users-light.png) |

## Features

- Resumable uploads of very large files with the [tus](https://tus.io) protocol, in chunks of 25 MB.
- Files encrypted on disk (AES-256-GCM). Upload, download and zip are streamed, so RAM use does not grow with file size.
- Share by link or email, with expiry, optional password and download limit. Revoke at any time.
- Users with roles and quotas, mandatory two-factor authentication for admins.
- Italian and English interface, light and dark theme, configurable branding.
- Setup wizard for admin, SMTP, Cloudflare tunnel and general settings.

## Quick start

On a Debian 12 LXC (or any Linux host) with Docker and the Compose plugin. The full guide, including the LXC preparation, is in the [documentation](https://ivanerricis.github.io/easysend/guide/install).

```sh
sudo mkdir -p /opt/easysend && sudo chown "$USER": /opt/easysend && cd /opt/easysend
V=0.1.0; RAW=https://raw.githubusercontent.com/ivanerricis/easysend/v$V; mkdir -p scripts/lib
curl -fsSL -o docker-compose.yml $RAW/docker-compose.yml && curl -fsSL -o .env.example $RAW/.env.example
for f in deploy.sh rollback.sh backup.sh uninstall.sh lib/common.sh; do curl -fsSL -o scripts/$f $RAW/scripts/$f; done
chmod +x scripts/*.sh && cp .env.example .env && chmod 600 .env
./scripts/deploy.sh
```

Then open an SSH tunnel from your PC (`ssh -L 8080:127.0.0.1:8080 <user>@<lxc-address>`), go to http://localhost:8080 and follow the setup wizard. The setup code is in the api log: `docker compose logs api | grep "Setup code"`.

## Documentation

Full documentation: **https://ivanerricis.github.io/easysend/** (also in [Italian](https://ivanerricis.github.io/easysend/it/)).

- [Introduction and architecture](https://ivanerricis.github.io/easysend/guide/introduction)
- [Requirements](https://ivanerricis.github.io/easysend/guide/requirements) and [LXC preparation](https://ivanerricis.github.io/easysend/guide/lxc)
- [Installation](https://ivanerricis.github.io/easysend/guide/install) and [first setup](https://ivanerricis.github.io/easysend/guide/first-setup)
- [Cloudflare API token](https://ivanerricis.github.io/easysend/guide/cloudflare)
- [Backup and restore](https://ivanerricis.github.io/easysend/guide/backup)
- [Updating and rollback](https://ivanerricis.github.io/easysend/guide/updates)
- [Security notes](https://ivanerricis.github.io/easysend/guide/security) and [troubleshooting](https://ivanerricis.github.io/easysend/guide/troubleshooting)

## Development

Node 26 and pnpm 12.14.0 (`fnm use` picks the right Node), Docker Desktop running. `pnpm install && pnpm local:up` starts the whole stack on http://localhost:8080 with Mailpit on http://localhost:8025. Details, commands and tests: [Local development](https://ivanerricis.github.io/easysend/development/local).

## License

[MIT](LICENSE). Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).
