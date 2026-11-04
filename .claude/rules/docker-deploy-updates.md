---
paths:
  - 'docker/**'
  - 'scripts/**'
  - 'docker-compose*.yml'
  - '**/Dockerfile'
  - '.env.example'
  - 'apps/api/tsdown.config.ts'
  - 'apps/api/src/updates/**'
  - 'apps/api/src/routes/admin-updates.ts'
---

# Docker, deploy e aggiornamenti

## Immagini e produzione

- nginx `nginx:1.30.6-alpine3.24-slim`, non-root, porta 8080, `proxy_pass` con variabile e `resolver 127.0.0.11`. Health `/health` → `/api/health`; healthcheck del web su una location statica. Su `/api/*` nasconde gli header di helmet che imposta già; COOP e CORP `same-origin`. `log_format` senza IP, referer, user agent, token mascherati.
- cloudflared: immagine wrapper (alpine + binario statico + `entrypoint.sh` che attende il token), pubblicata come `easysend-cloudflared`.
- API: bundle tsdown, esterne solo `better-sqlite3`, `sharp`, `@node-rs/argon2` (una nuova nativa va in `NATIVE`); licenze in `dist/THIRD-PARTY-LICENSES.txt`; binario node senza simboli, solo prebuild musl, niente sourcemap.
- Produzione: porta web solo su 127.0.0.1; `.env.example` imposta `COMPOSE_FILE=docker-compose.yml` (mai l'override di build). Limiti: api 768m (`--max-old-space-size=384`), web 128m, cloudflared 128m; Mailpit locale 128m. Log json-file 3×10 MB.
- Misure (fase 6): immagini api 241 MB, web 32 MB, cloudflared 73 MB; RAM a riposo api 43 MiB, web 8 MiB; file da 1 GB: RSS max 156 MB, container max 482 MB.
- `CLOUDFLARE_API_BASE` e `UPDATE_CHECK_URL`: solo per i test, mai nel compose di produzione.
- `DATA_PATH` facoltativo (cartella assoluta dell'host, uid/gid 1000) sostituisce il volume `easysend-data` (`${DATA_PATH:-easysend-data}:/data`); `DATA_HOST_PATH` solo per la visualizzazione (`admin.storage` → `dataLocation.hostPath`, null = volume). `deploy.sh`/`rollback.sh` la validano (uscita 22) e rifiutano una release il cui compose la ignora; `backup.sh` monta la cartella; `uninstall.sh --purge` non la cancella mai; i dati non si spostano da soli (guida `data-location`).

## Deploy

- Manuale: `deploy.sh`, `rollback.sh`, `backup.sh`, `uninstall.sh` (bash, `scripts/lib/common.sh`), stato in `.deploy/`, immagini `${IMAGE_PREFIX:-ghcr.io/ivanerricis/easysend}-<servizio>:${APP_VERSION}`; salute con `docker compose exec web wget /health`. Provati in simulazione (registry locale e container Debian 12). `deploy.sh` aggiorna anche gli script dell'LXC (copia precedente in `.deploy/`).

## Aggiornamento con un clic (fase 7)

- Avviso di nuova release: l'API interroga GitHub solo su richiesta di un admin, cache 24 ore, disattivabile (`updateCheck`). Niente socket Docker nei container.
- Protocollo a file: `/opt/easysend/updates/` ↔ `/updates` (bind `./updates:/updates`, `UPDATE_DIR`): `runner.json` (installer), `request` (API, `id`/`version`/`requestedAt`, 0640), `status.json` (runner e `deploy.sh`, 0644, rename).
- `update-service.sh install [--user U]` (root) crea `updates/` (uid 1000 + gruppo del runner, 2770) e le unità `easysend-update.path` (`PathExists`) e `.service` (oneshot, utente proprietario dell'installazione nel gruppo `docker`, `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full`, `ProtectHome=read-only` quindi installazione in `/opt`, timeout 45 min).
- `update-runner.sh` sposta la richiesta fuori dalla cartella scrivibile, la valida (3 righe, id hex 32, semver, niente `eval`), la consuma sempre e lancia `deploy.sh <versione> --yes` (log in `.deploy/update.log`, 5 conservati). Uscite di `deploy.sh` in `common.sh`: 75 occupato (lock condiviso), 20 compose, 21 backup, 22 `DATA_PATH` (trattata come compose), 30 ripristinato, 31 rollback fallito; passi `starting, compose, backup, pull, restart, health, rollback, done`.
- API (`routes/admin-updates.ts`): solo release pubblicate `X.Y.Z` più recenti di quella in uso (elenco fino a 30), ricontrollate su GitHub; admin, CSRF, 5/ora (`updates/policy.ts`), audit `system.update_requested`. Richiesta non presa entro 2 minuti = "non risponde"; `running` oltre 45 minuti non blocca. Non disponibile in locale; nessun rollback dalla UI.
- Da 0.1.x: il vecchio `deploy.sh` non scarica runner e service; vanno presi a mano una volta (guida `updates`), poi `sudo ./scripts/update-service.sh install`.
- Cartella di installazione protetta (`protected_install_prefix` in `lib/common.sh`: `/home`, `/root`, `/run/user`, `/usr`, `/boot`, `/efi`, `/etc`, link risolti): `update-service.sh install` rifiuta, `status` e `deploy.sh` avvisano senza bloccare; la guida `updates` spiega come spostare i file in `/opt/easysend` mantenendo i volumi (stesso nome di progetto). Nato dall'LXC di produzione installato in `/home/easysend`.
