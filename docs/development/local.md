# Local development

Prerequisites: Node 26 (version in `.nvmrc`; with [fnm](https://github.com/Schniz/fnm) just `fnm use`), pnpm 12.14.0 (`packageManager` field) and Docker Desktop running.

```sh
pnpm install
pnpm local:up
```

| Command            | What it does                                                    |
| ------------------ | --------------------------------------------------------------- |
| `pnpm local:up`    | builds and starts the stack in Docker (web, api, Mailpit)       |
| `pnpm local:down`  | stops it, keeping the data                                      |
| `pnpm local:reset` | stops it and deletes the local volumes                          |
| `pnpm dev`         | api (tsx watch) and Vite outside Docker, only Mailpit in Docker |

Addresses:

- Docker stack: http://localhost:8080 (app), http://localhost:8080/api/health, http://localhost:8025 (Mailpit).
- `pnpm dev`: http://localhost:5173 (Vite with hot reload and a proxy to the api on port 3000). Data goes to `.local-data/`.

Mailpit catches every email, whatever the recipient. If other projects use the same ports, change them in `.env.local` (created from `.env.local.example`): `LOCAL_WEB_PORT`, `MAILPIT_UI_PORT`, `MAILPIT_SMTP_PORT`, `DEV_API_PORT`, `DEV_WEB_PORT`.

To skip the wizard, create an admin from the command line (local mode only; it asks for the password twice, and 2FA is configured at the first login):

```sh
pnpm user:create-admin -- --email you@example.com
# in the Docker stack: docker compose -p easysend-local exec api node dist/cli/create-admin.js --email you@example.com
```

## Notes

- **Browsers**: session cookies are `Secure`. Chrome, Firefox and Edge accept them on http://localhost, Safari does not. Open the app only from `localhost`, not from the LAN IP.
- **Windows**: using WSL2 and keeping the project in the Linux filesystem (for example `~/projects`) is recommended, for volume performance and correct permissions.
- **Docker Desktop disk**: locally the free space the app sees is that of the Docker Desktop virtual disk, not of your PC. To enlarge it: Docker Desktop, Settings, Resources, Disk image size. The virtual disk file (VHDX) does not shrink automatically when you free space.

## Documentation site

This site is built with [VitePress](https://vitepress.dev) from the `docs/` folder (English in `docs/`, Italian in `docs/it/`, same file names). `pnpm docs:dev` serves it with hot reload and `pnpm docs:build` builds it into `docs/.vitepress/dist`, failing on dead links. It is published to GitHub Pages by `.github/workflows/docs.yml` on every push to `main` that touches `docs/`.
