---
paths:
  - 'apps/api/src/storage/**'
  - 'apps/api/src/routes/admin-storage.ts'
  - 'apps/api/src/cli/storage-migrate.ts'
  - 'apps/web/src/pages/settings-forms/Storage*'
  - 'apps/web/src/pages/admin/settings/{StorageSettingsPage,MigrationCard}.tsx'
  - 'apps/web/src/pages/setup/StorageStep.tsx'
  - 'docker/docker-compose.test.yml'
---

# Archiviazione dei file (fase 9, S3 facoltativo)

## Driver e dati

- Client S3 nostro su `aws4fetch` (firma SigV4, niente `@aws-sdk`): `storage/s3/client.ts` (timeout 30 s per le chiamate di controllo, 300 s per quelle che muovono una parte; errori mappati su motivi sicuri `ACCESS_DENIED`, `NO_SUCH_BUCKET`, `SIGNATURE`, `TIMEOUT`, `NETWORK`, `ENDPOINT`, mai il messaggio del provider) e `storage/s3/driver.ts`.
- Interfaccia `StorageDriver` (`storage/types.ts`): `put(name, stream, size)` tutto o niente, `openReader` (letture a intervalli, `read(offset, length)`), `delete` (non lancia, `false` se fallisce), `list`, `recover`, `capacity`. I driver vedono solo byte cifrati con nome UUID (`transfer_files.storage_name`); la cifratura sta sopra (`crypto/segments.ts`). Locale: `<name>.part`, fsync, rename atomico. S3: PutObject fino a una parte, altrimenti multipart da 16 MB (`S3_PART_SIZE_BYTES`), 3 tentativi con backoff lineare sui guasti transitori; all'avvio `recover` annulla i multipart più vecchi di 24 ore.
- Colonna `transfer_files.storage` (`local|s3`, default `local`): ogni file ricorda dove sta; cambiare driver riguarda solo i nuovi file. `ctx.storage.forFile(kind)` per leggere, `current()` per scrivere.
- Tabelle `storage_migrations` (stato del job) e `storage_deletions` (cancellazioni differite: `storage`, `name`, `delete_after`, `attempts`).
- Impostazione `storage` (`driver`, `s3`, `source: env|panel`) cifrata per intero con la chiave HKDF `storage` (da `APP_SECRET_KEY`, ricifrata dalla CLI di rotazione). La secret key non esce mai dalle API (`hasSecret`).

## Configurazione

- Il `.env` (`STORAGE_DRIVER`, `S3_*`, `S3_SECRET_ACCESS_KEY` o `S3_SECRET_ACCESS_KEY_FILE` relativo a `secretsDir`) si importa solo al primo avvio, quando l'impostazione non esiste (`importStorageEnv`); poi la verità è il DB. Configurazione non valida = `ConfigError` con i nomi delle variabili. `envDiffers` (solo booleano) segnala nella pagina che il `.env` non coincide più.
- Prova prima di salvare: `POST` di prova scrive, legge ed elimina un oggetto; l'impronta SHA-256 della configurazione effettiva (secret compresa) provata con successo resta in memoria 30 minuti (`storage/verification.ts`, un solo slot); il salvataggio di dati S3 nuovi o modificati, o che attivano `s3`, senza prova risponde `STORAGE_NOT_VERIFIED`. Passare a `local` non richiede prova e conserva la configurazione S3. `STORAGE_TEST_FAILED` espone solo `details.reason`. Rate limit della prova: 10/ora (`setupLimiters.storageTest`).
- `STORAGE_IN_USE`: finché esistono file con `storage = 's3'` o una migrazione è attiva, endpoint, bucket e prefisso non si cambiano (nel form sono bloccati); regione, path-style e chiavi sì, dopo una prova.
- Il wizard ha il passo facoltativo "Dove salvare i file" tra Cloudflare e Impostazioni generali (`StorageStep`, stesso `StorageForm` del pannello); lo stato del setup non ha un flag `storage`, quindi non blocca mai.

## Spazio

- Locale: `libero(STORAGE_DIR) − riserva ≥ 2 × dimensione` (file tus più copia cifrata). S3: `libero(TMP_UPLOAD_DIR) − riserva ≥ 1 × dimensione` (la copia cifrata esce dal server); sul bucket non si controlla nulla (`storage/disk.ts`, `uploadFits`). La pagina Spazio mostra la cartella che gli upload consumano davvero (`spaceProbeDir`).

## Eliminazioni

- Le righe DB si cancellano in transazione, poi `deleteStoredObjects` chiama il driver di ogni file; se fallisce (o S3 non risponde) l'oggetto finisce in `storage_deletions`. La pulizia oraria li riprova; dopo `MAX_DELETION_ATTEMPTS` (10) la riga si scarta con un warning (gli orfani li recupera comunque la scansione). La pulizia degli orfani scorre entrambi i driver e chiude i multipart vecchi.

## Migrazione

- Copia i byte cifrati così come sono (nessuna ricifratura, chiavi invariate), un file alla volta in blocchi da 4 MiB (RAM costante). Il file passa a `storage = nuovo` solo a copia completa e verificata sulla dimensione; la sorgente va in `storage_deletions` con attesa `SOURCE_GRACE_SECONDS` (1 ora) così i download in corso finiscono. Per `local` si controlla lo spazio per tutti i byte; per `s3` serve la configurazione salvata.
- Una sola migrazione alla volta (transazione immediata, vale anche contro la CLI): `MIGRATION_RUNNING`. Annullabile: si ferma dopo il file in corso (`cancelling`, poi `cancelled`). Un file che fallisce incrementa `failed_files` e si prosegue; `MAX_CONSECUTIVE_UNAVAILABLE` (5) storage irraggiungibili di fila fanno fallire il job. Allo spegnimento il ciclo si ferma tra due file e la riga resta `running`: al riavvio riprende da sola.
- Pannello: `MigrationCard` (polling ogni 2 s mentre è attiva, conferma, avanzamento con `Progress`, esito). Endpoint `storage.migration*` solo admin, con CSRF e audit.
- CLI: `pnpm storage:migrate -- --to s3|local [--dry-run]`; in produzione `docker compose exec api node dist/cli/storage-migrate.js --to s3|local [--dry-run]` (entry `cli/storage-migrate` in `tsdown.config.ts`). Avanzamento a terminale, Ctrl+C ferma dopo il file in corso; la cancellazione delle sorgenti la fa il job di pulizia dell'API.

## Cosa resta in locale

- Database, `secrets/`, branding e i file temporanei tus (`TMP_UPLOAD_DIR`: il file in chiaro arriva lì, viene cifrato e inviato al bucket, poi cancellato). Il download passa sempre dall'API (letture a intervalli e decifratura al volo), mai redirect al bucket.
- Il backup (`scripts/backup.sh`) non include gli oggetti S3: il bucket si salva a parte; DB (chiavi wrapped, impostazione `storage` cifrata) e chiave master nell'archivio bastano a decifrarli.

## Test

- Unitari e API con driver S3 simulato (`apps/api/test`). E2E `80-storage-s3.spec.ts` contro MinIO nel compose di test: immagine `bitnamilegacy/minio:2025.7.23-debian-12-r5` (le immagini `minio/minio` ufficiali non sono più pubblicate su Docker Hub né Quay; è la copia congelata di Bitnami), bucket `easysend` creato da `MINIO_DEFAULT_BUCKETS`, credenziali usa e getta nel compose, raggiungibile solo come `http://minio:9000` (path-style), 256m, senza porta sull'host; il bucket si ispeziona con `mc` dentro il container (`composeExec('minio', …)`). Se serve una versione nuova, cambia solo il tag.
- La spec lascia l'istanza su disco locale, così le spec successive e gli screenshot non cambiano.

## Misure

- Vedi il riepilogo della fase 9 nella pull request per RAM e tempi di upload, download e zip di un file da 1 GB su MinIO (confronto con il disco locale: RSS massimo 156 MB, container 482 MB).
