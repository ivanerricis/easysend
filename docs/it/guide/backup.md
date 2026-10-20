# Backup e ripristino

Cosa conservare:

| Cosa                            | Dove                               |
| ------------------------------- | ---------------------------------- |
| Database                        | volume `easysend-data`             |
| File cifrati                    | volume `easysend-data`             |
| Loghi, favicon, sfondo          | volume `easysend-data`             |
| Chiave master, segreto sessioni | volume `easysend-data`, `secrets/` |
| Configurazione                  | `.env`, `docker-compose.yml`       |

## Backup

```sh
./scripts/backup.sh            # scrive in /opt/easysend/backups
./scripts/backup.sh /mnt/usb   # oppure in un'altra cartella
```

Crea un backup coerente del database tramite la CLI di backup dell'api (mai una copia del file in uso), poi scrive `easysend-backup-<ora UTC>.tar.gz` con modo 600, che contiene il backup del database, `storage/`, `branding/`, `secrets/`, `.env` e `docker-compose.yml`.

::: warning L'archivio contiene la chiave master
Chi ha l'archivio può decifrare tutti i file. Conservalo cifrato oppure offline, e copialo fuori dall'LXC. Senza la chiave master (`APP_SECRET_KEY` o `/data/secrets/app.key`) i file, i segreti TOTP e la password SMTP sono illeggibili, anche se il resto dei dati è intatto.
:::

## Ripristino

Ripristino su un'installazione pulita o rotta (stessa versione o più recente). Gli stessi passi li stampa `./scripts/backup.sh --help`.

```sh
# 1. ricrea la cartella di installazione con .env, docker-compose.yml e scripts/ della release
mkdir /opt/easysend && cd /opt/easysend
tar xzf <archivio> .env docker-compose.yml
chmod 600 .env
#    (scarica scripts/ dalla release come nella pagina Installazione)

# 2. crea i volumi vuoti
docker compose create

# 3. copia i dati nel volume (<progetto> è il nome del progetto Compose,
#    di solito il nome della cartella di installazione: vedi `docker volume ls`)
docker run --rm -i -v <progetto>_easysend-data:/data alpine:3.24.2 \
  sh -c 'tar xzf - -C /tmp data && cp -a /tmp/data/. /data/' < <archivio>

# 4. ripristina il database (nome del file con: tar tzf <archivio> | grep sqlite)
docker compose run --rm --no-deps api node dist/cli/restore-db.js manual-<timestamp>.sqlite

# 5. avvia
docker compose up -d
```

Ogni tanto prova un ripristino su una macchina di prova: un backup mai ripristinato è solo una speranza.
