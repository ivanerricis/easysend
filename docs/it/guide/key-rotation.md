# Rotazione della chiave master

Ruota la chiave master se sospetti che sia trapelata. Il comando ricifra le chiavi dei singoli file, i segreti TOTP e le impostazioni cifrate, dopo aver salvato un backup del database. L'api deve essere ferma.

```sh
cd /opt/easysend
./scripts/backup.sh        # prima, sempre
docker compose stop api && docker compose run --rm --no-deps api node dist/cli/rotate-key.js && docker compose up -d api
```

- **Chiave in un file** (il caso predefinito, `/data/secrets/app.key`): la nuova chiave lo sostituisce e la vecchia resta come `app.key.previous`.
- **Chiave in `APP_SECRET_KEY`**: la nuova chiave viene scritta in `/data/secrets/app.key.new`. Copiala in `APP_SECRET_KEY` nel file `.env` prima di riavviare l'api.

Il comando è idempotente. Se è stato interrotto, rilancialo con `--new-key-file <file>` che punta alla stessa nuova chiave. La chiave non viene mai stampata. I codici di recupero non dipendono dalla chiave master e restano validi.
