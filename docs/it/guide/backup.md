# Backup e ripristino

Cosa conservare:

| Cosa                            | Dove                                  |
| ------------------------------- | ------------------------------------- |
| Database                        | volume `easysend-data`                |
| File cifrati                    | volume `easysend-data` (disco locale) |
| Loghi, favicon, sfondo          | volume `easysend-data`                |
| Chiave master, segreto sessioni | volume `easysend-data`, `secrets/`    |
| Configurazione                  | `.env`, `docker-compose.yml`          |

Se hai impostato `DATA_PATH` in `.env` ([Posizione dei dati](./data-location)), leggi "volume `easysend-data`" qui sopra come quella cartella dell'host: lo script e i passi di ripristino qui sotto usano la cartella al posto del volume.

## Backup

```sh
./scripts/backup.sh            # scrive in /opt/easysend/backups
./scripts/backup.sh /mnt/usb   # oppure in un'altra cartella
```

Crea un backup coerente del database tramite la CLI di backup dell'api (mai una copia del file in uso), poi scrive `easysend-backup-<ora UTC>.tar.gz` con modo 600, che contiene il backup del database, `storage/`, `branding/`, `secrets/`, `.env` e `docker-compose.yml`.

::: warning L'archivio contiene la chiave master
Chi ha l'archivio può decifrare tutti i file. Conservalo cifrato oppure offline, e copialo fuori dall'LXC. Senza la chiave master (`APP_SECRET_KEY` o `/data/secrets/app.key`) i file, i segreti TOTP e la password SMTP sono illeggibili, anche se il resto dei dati è intatto.
:::

::: warning I file su S3 non sono nell'archivio
Se salvi i file su un servizio compatibile S3 ([Archiviazione S3](./s3-storage)), l'archivio contiene solo i file ancora sul disco locale. Fai il backup del bucket a parte: versioning o replica del provider, oppure un `rclone sync` periodico verso un altro bucket. L'archivio contiene comunque ciò che serve per decifrare quei file: il backup del database (la chiave avvolta di ogni file e le impostazioni S3 cifrate) e la chiave master. Senza il bucket, o senza la chiave master, i file sono persi.
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
