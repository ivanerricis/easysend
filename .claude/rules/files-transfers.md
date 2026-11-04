---
paths:
  - 'apps/api/src/uploads/**'
  - 'apps/api/src/crypto/**'
  - 'apps/api/src/storage/**'
  - 'apps/api/src/downloads/**'
  - 'apps/api/src/transfers/**'
  - 'apps/api/src/jobs/**'
  - 'apps/api/src/db/**'
  - 'apps/api/src/routes/{transfers,downloads}.ts'
  - 'apps/web/src/features/upload/**'
  - 'apps/web/src/pages/{transfers,download}/**'
---

# Upload, cifratura, download e pulizia

## Upload e cifratura

- Flusso: bozza `POST /transfers`, upload tus con `transferId` nei metadati, `POST /transfers/:id/finalize` che attiva e invia le email; `finalize` ricalcola la scadenza da quel momento con la stessa durata.
- Cifratura asincrona: il PATCH tus finale risponde 204, l'upload passa a `processing`, un worker (uno alla volta) calcola SHA-256 e cifra. `finalize` = `UPLOAD_INCOMPLETE` finché c'è un upload `in_progress`/`processing`; HEAD su `processing`/`completed` risponde `Upload-Offset = Upload-Length`; al riavvio il worker riprende i `processing` e cancella i `*.part`.
- Formato v1: AES-256-GCM a segmenti da 64 KiB, record `ciphertext ‖ tag`, nonce = prefisso casuale 7 byte ‖ indice uint32 ‖ flag ultimo (STREAM); chiave dati per file wrapped con la chiave `file` in formato `v1:`.
- `used_bytes` = somma in chiaro dei file completati. Quota: `used_bytes + upload in volo + Upload-Length ≤ quota`; spazio: su disco locale `libero − riserva ≥ 2 × dimensione`, con S3 `libero(TMP_UPLOAD_DIR) − riserva ≥ 1 × dimensione` (vedi `storage.md`).
- Id degli upload tus validati con lo schema Zod prima di ogni accesso al DB. Non si usa `cleanUpExpiredUploads` di tus (cancellerebbe upload in elaborazione).
- Migrazioni all'avvio: backup `sqlite.backup()` prima di ogni migrazione su DB non vuoto (ultimi 5).

## Download

- Pagina pubblica `PUBLIC_URL/d/<token>`, token 32 byte base64url. Sblocco password: cookie `es_dl` = `exp.HMAC(transferId:exp:impronta password_hash)`, `Path=/api/downloads/<token>`, 1 ora; cambiare o togliere la password lo invalida.
- Conteggio: ogni richiesta (file o zip) dal byte 0; il primo fa partire la notifica. Un download di file conteggiato imposta `es_dlr` = `exp.HMAC(resume:transferId:fileId:exp)` (chiave `download-cookie`, `Path=/api/downloads/<token>/files/<fileId>`, Lax, 24 ore): un Range che non parte da 0 è gratis solo con quel cookie, altrimenti conta (`curl -C -` consuma un download a ogni ripresa).
- Limite stretto: raggiunto il limite si rifiutano anche i Range.
- Zip in streaming senza compressione (`yazl`, store, ZIP64 automatico) con `Content-Length` calcolato, un file aperto alla volta.
- `transfers.notified_at` = solo "mittente avvisato del primo download"; se l'invio fallisce torna NULL e il download successivo riprova.
- Rate limit (`transfers/policy.ts`): creazione e reinvio 30/ora per utente, download 600/10 min per IP, password 10 errori/15 min per link+IP e 50/ora per link.

## Pulizia ed eliminazioni

- Job (`node-cron`) ogni ora e all'avvio, mai due in parallelo (`CLEANUP_CRON` non valido blocca l'avvio): trasferimenti scaduti/revocati e bozze inattive (poi `TRANSFER_NOT_FOUND`), upload scaduti, orfani (storage, su ogni driver, oltre 1 ora; tmp oltre il TTL), cancellazioni differite di `storage_deletions`, log oltre `LOG_RETENTION_DAYS`, token di reset e sessioni scadute, riallineamento di `used_bytes`, richieste di file scadute o revocate. Non tocca i `processing`; niente audit, una riga di log riassuntiva.
- Stati `deleted` ed `expired` dei trasferimenti riservati nell'enum, mai scritti (`expired` si calcola).
- Eliminazione file: prima le righe DB in transazione, poi cancellazione best effort tramite il driver del file (`storage` locale o S3); un fallimento va nella coda `storage_deletions` (riprovata dalla pulizia, al massimo 10 tentativi) e gli orfani li recupera comunque la scansione degli orfani (vedi `storage.md`).

## Frontend dell'upload

- Un file alla volta, attesa della cifratura (polling) e `finalize`; bozza in localStorage `easysend-draft` (senza password) da riprendere riselezionando i file; blocco nel form oltre la quota residua.
