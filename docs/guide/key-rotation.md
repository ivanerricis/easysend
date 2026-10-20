# Master key rotation

Rotate the master key if you suspect it leaked. The command re-encrypts the per-file keys, TOTP secrets and encrypted settings, after saving a database backup. The api must be stopped.

```sh
cd /opt/easysend
./scripts/backup.sh        # first, always
docker compose stop api && docker compose run --rm --no-deps api node dist/cli/rotate-key.js && docker compose up -d api
```

- **Key in a file** (the default, `/data/secrets/app.key`): the new key replaces it and the old one is kept as `app.key.previous`.
- **Key in `APP_SECRET_KEY`**: the new key is written to `/data/secrets/app.key.new`. Copy it into `APP_SECRET_KEY` in `.env` before starting the api again.

The command is idempotent. If it was interrupted, rerun it with `--new-key-file <file>` pointing at the same new key. The key is never printed. Recovery codes do not depend on the master key and stay valid.
