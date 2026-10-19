# CLAUDE.md

Applicazione web self-hosted per il trasferimento di file di grandi dimensioni, simile a WeTransfer.
I requisiti completi sono in `docs/SPEC.md`: leggilo all'inizio di ogni sessione e prima di ogni fase.
Questo file contiene solo le regole fisse e le decisioni già prese.

## Come lavori con me
- Rispondimi in italiano. Codice, nomi di variabili, commenti e messaggi di commit in inglese.
- Lavoriamo per fasi (vedi `docs/FASI.md`). Alla fine di ogni fase fermati e dammi: cosa hai fatto, compromessi scelti, come verificarlo.
- Se una scelta non è specificata, proponi un'opzione ragionevole e dichiarala. Chiedimi solo per decisioni importanti e difficili da cambiare dopo.
- Prima di dire che una fase è finita: lint, typecheck e test devono passare. Se qualcosa non passa, dimmelo.
- Nel riepilogo di ogni fase includi "Come provarlo in locale": comandi da lanciare, indirizzi da aprire e cosa dovrei vedere.
- Non aggiungere dipendenze senza dirmi quale e perché. Preferisci librerie mantenute, leggere e compatibili con Alpine (musl).
- Quando prendiamo una decisione nuova, aggiungila alla sezione "Decisioni" in fondo a questo file.
- Mai segreti nel repository, nei log o nei messaggi di errore.

## Git e GitHub
- Il repository GitHub lo crei tu nella fase 0 con la CLI `gh` (dettagli in SPEC.md sezione 15). Se `gh` non è installata o autenticata, fermati e dimmi il comando da eseguire: non chiedermi mai token o password in chat.
- `main` è sempre rilasciabile. Ogni fase si sviluppa su un branch dedicato (`feat/fase-N-descrizione`) con commit piccoli in formato Conventional Commits.
- A fine fase fai push e apri una pull request collegata all'issue della fase, con il riepilogo della fase come descrizione. La CI deve essere verde. Il merge lo faccio io: tu non fai merge su `main`, non fai force push e non modifichi le regole di protezione senza chiedermelo.
- Dopo il mio merge, aggiorna il `main` locale ed elimina il branch della fase prima di iniziare la successiva.

## Skill
- All'inizio di ogni fase controlla le skill disponibili (personali, di progetto in `.claude/skills/` e dei plugin installati) e usa tutte quelle pertinenti al lavoro della fase. Dimmi in una riga quali stai usando.
- Esempi: una skill di design frontend per interfaccia, pagine e tema; una skill di test web con Playwright per gli E2E; skill per Docker, sicurezza o documentazione se presenti.
- Se una skill utile manca, dimmelo e suggerisci dove trovarla, poi prosegui comunque.
- Quando una procedura si ripete (nuova migrazione Drizzle, aggiunta di un endpoint con schema Zod condiviso, release con tag e push su GHCR), proponi di salvarla come skill di progetto in `.claude/skills/<nome>/SKILL.md`, così resta coerente nelle sessioni successive.
- Le istruzioni di una skill non prevalgono su questo file né su `docs/SPEC.md`: in caso di conflitto segui questi e segnalami il conflitto.

## Stack
- Monorepo con pnpm workspaces, TypeScript strict, ESM, Node.js LTS attiva (verifica la versione corrente).
- `apps/web`: React + Vite + TypeScript + shadcn/ui (Tailwind), i18n italiano/inglese, tema chiaro/scuro tramite variabili CSS. Servito da Nginx.
- `apps/api`: Express + TypeScript, Zod, Nodemailer, upload con protocollo tus (`@tus/server` + `@tus/file-store`). Multer NON si usa.
- `packages/shared`: schemi Zod, tipi e costanti (es. opzioni di scadenza) usati da frontend e backend. Nessuna duplicazione dei tipi.
- Database: SQLite in modalità WAL con Drizzle ORM. Nessun container database separato.
- Deploy: Docker Compose (web con Nginx, api, cloudflared), immagini Alpine multi-stage, pubblicate su GHCR.
- Test: Vitest (unitari), Supertest (API), Playwright (E2E).
- CI/CD: GitHub Actions, immagini su GHCR, versioni e release automatiche con release-please. Dipendenze aggiornate con Dependabot.

## Struttura del repository
```
apps/web/          frontend
apps/api/          backend
packages/shared/   schemi Zod, tipi, costanti
docker/            nginx.conf, entrypoint di cloudflared, compose di test
e2e/               test Playwright
docs/              SPEC.md, FASI.md, api.md
.github/           workflow CI/CD, Dependabot, template di issue e pull request
```

## Vincoli che non cambiano
- Produzione: LXC Debian 12 su Proxmox con Docker dentro, 2 GB di RAM per tutto lo stack (somma dei limiti sotto circa 1,5 GB).
- Sviluppo e prove: il mio PC con Docker Desktop, su http://localhost:8080 con APP_MODE=local, senza Cloudflare e con Mailpit (SPEC sezione 11-bis). Dalla fase 1 in poi il progetto deve sempre potersi avviare in locale.
- Cloudflare free: nessuna richiesta oltre 100 MB, chunk di upload da 25 MB (massimo 50).
- File cifrati su disco lato server. Upload, download e zip sempre in streaming, con uso di RAM costante.
- Validazione Zod su ogni input. Controllo di autorizzazione su ogni risorsa.
- Accessibilità WCAG 2.2 AA.

## Comandi
Prerequisiti: Node 26 (versione in `.node-version`/`.nvmrc`, con fnm basta `fnm use`), pnpm 12.14.0 (campo `packageManager`), Docker Desktop avviato per `local:*`.

| Comando               | Cosa fa                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| `pnpm install`        | Installa le dipendenze di tutto il monorepo                               |
| `pnpm dev`            | Avvia api (tsx watch) e Vite fuori da Docker, più Mailpit in un container |
| `pnpm lint`           | ESLint su tutto il repository, zero warning                               |
| `pnpm format`         | Formatta con Prettier                                                     |
| `pnpm format:check`   | Controlla la formattazione senza modificare i file                        |
| `pnpm typecheck`      | `tsc --noEmit` in ogni pacchetto                                          |
| `pnpm test`           | Test Vitest di tutti i pacchetti                                          |
| `pnpm test:e2e`       | Test Playwright (arrivano nella fase 6)                                   |
| `pnpm test:mailpit`   | Avvia Mailpit dal compose di test (`docker/docker-compose.test.yml`, porte 11025/18025), invia le email vere e le controlla via API, poi lo ferma |
| `pnpm mail:preview`   | Scrive le anteprime HTML e testo di tutte le email (it/en) in `.local-data/mail-preview/` |
| `pnpm build`          | Build di shared, api e web                                                |
| `pnpm db:generate`    | Genera la migrazione Drizzle dallo schema                                 |
| `pnpm db:migrate`     | Applica le migrazioni al database                                         |
| `pnpm db:check`       | Fallisce se lo schema e le migrazioni committate non coincidono           |
| `pnpm api:docs`       | Rigenera `docs/api.md` dal registro del contratto                         |
| `pnpm api:docs:check` | Fallisce se `docs/api.md` non è aggiornato                                |
| `pnpm local:up`       | Costruisce e avvia lo stack locale in Docker (web, api, Mailpit)          |
| `pnpm local:down`     | Ferma lo stack locale, mantenendo i dati                                  |
| `pnpm local:reset`    | Ferma lo stack e cancella i volumi locali                                 |
| `pnpm user:create-admin -- --email <email>` | Solo con `APP_MODE=local`: crea un admin senza 2FA (al primo login lo configura). Nello stack Docker: `docker compose -p easysend-local exec api node dist/cli/create-admin.js --email <email>` |
| `pnpm key:rotate [-- --new-key-file <file>]` | Ruota la chiave master (API ferma): ri-cifra chiavi dati dei file, secret TOTP e impostazioni cifrate, backup del DB prima. Nello stack Docker: `docker compose stop api && docker compose run --rm --no-deps api node dist/cli/rotate-key.js && docker compose up -d api` |
| `node scripts/measure-transfer.mjs [--size-gb 5]` | Con lo stack locale avviato: upload tus, cifratura, download e zip di un file generato, con RAM dell'api campionata ogni secondo |

Indirizzi in locale:
- stack Docker: http://localhost:8080 (frontend), http://localhost:8080/api/health (health), http://localhost:8025 (Mailpit);
- `pnpm dev`: http://localhost:5173 (Vite con proxy verso l'api).

Se altri progetti occupano le porte predefinite, si cambiano in `.env.local`: `LOCAL_WEB_PORT`, `MAILPIT_UI_PORT`, `MAILPIT_SMTP_PORT`, `DEV_API_PORT`, `DEV_WEB_PORT`.

Regole:
- dopo ogni modifica al contratto (`packages/shared/src/contract` o gli schemi) lancia `pnpm api:docs` e committa `docs/api.md`;
- dopo ogni modifica allo schema Drizzle lancia `pnpm db:generate` e committa la migrazione.

## Decisioni
- Database: SQLite WAL.
- Upload: protocollo tus.
- Cifratura: lato server, envelope encryption a segmenti (dettagli in SPEC.md).
- Notifica al primo download: sempre attiva.
- Log di download e audit: conservati 90 giorni.
- Nessuna anteprima dei file, nessun antivirus integrato, nessuna registrazione pubblica.
- Contratto API: generato nella fase 1 in `docs/api.md` e approvato da me prima di proseguire.
- Repository GitHub creato da Claude nella fase 0, una pull request per fase, merge solo da parte mia.
- Versionamento: prima release 0.1.0 a fine fase 6, in 0.x i cambiamenti incompatibili alzano la minor. La 1.0.0 la decido io.
- Aggiornamento dipendenze con Dependabot (si configura interamente da file, senza app esterne da installare).
- Repository: `ivanerricis/easysend`, pubblico, licenza MIT.
- Deploy sull'LXC: metodo manuale (`scripts/deploy.sh [versione]` e `scripts/rollback.sh`), da implementare nella fase 6.
- `main` protetto da ruleset `protect-main`: PR obbligatoria, controlli obbligatori `lint`, `typecheck`, `test`, `build` (nomi dei job da non rinominare mai), branch aggiornato, niente force push né cancellazione. Solo squash merge con titolo della PR.
- release-please: tipo `simple`, manifest `0.0.0` e `release-as: 0.1.0`; rimuovere `release-as` subito dopo il merge della release 0.1.0.
- La PR di release creata con GITHUB_TOKEN ha la CI in attesa di approvazione ("action required"): prima di unire la release si approva il run dalla PR ("Approve workflows to run") o con `gh api -X POST repos/ivanerricis/easysend/actions/runs/<id>/approve`. Il dispatch della CI è stato tolto perché i controlli lanciati così non si collegano alla PR. Niente bypass, niente PAT.
- Lingua su GitHub: template, issue ed etichette in inglese; riepiloghi di fase nelle PR in italiano.
- Il progetto resta in `C:\` su Windows (non in WSL2); nel README va la nota di SPEC 11-bis.
- Node 26 gestito con fnm, pnpm 12.14.0 in `packageManager`. Lint con ESLint 10 (flat) più Prettier.
- TypeScript fissato alla 6.0.x: typescript-eslint non accetta ancora TS 7 (Dependabot ignora `typescript >=6.1`).
- `packages/shared` è consumato come sorgente TypeScript (nessun build); l'API lo include nel bundle con tsdown, quindi è una devDependency dell'API.
- Versioni condivise nel `catalog:` di `pnpm-workspace.yaml`.
- Contratto API: registro degli endpoint in `packages/shared/src/contract`, trasformato in `docs/api.md` da uno script; `api:docs:check` in CI fallisce se il documento è vecchio.
- Convenzioni API: timestamp in secondi Unix; errore standard `{ error: { code, message, requestId, details? } }` con codici stabili tradotti dal frontend; chi non è proprietario riceve 404, non 403; livelli di autenticazione `public | mfa-pending | session | admin | setup`.
- Flusso del trasferimento: bozza con `POST /transfers`, upload tus con `transferId` nei metadati, poi `POST /transfers/:id/finalize` che attiva il trasferimento e invia le email.
- Conteggio download: conta ogni richiesta (file o zip) che parte dal byte 0; il primo conteggio fa partire la notifica. Un download di file conteggiato imposta il cookie di ripresa `es_dlr` = `exp.HMAC(resume:transferId:fileId:exp)` (chiave `download-cookie`, `Path=/api/downloads/<token>/files/<fileId>`, SameSite=Lax, 24 ore): una richiesta Range che non parte da 0 è gratuita solo con quel cookie valido, altrimenti conta (così `bytes=1-` non aggira il limite né la notifica). Chi riprende senza cookie (es. `curl -C -`) consuma un download a ogni ripresa.
- Sblocco di un link con password: cookie firmato con `Path=/api/downloads/<token>`, durata 1 ora.
- Immagini di branding: upload con corpo raw (png/jpeg/webp, controllo dei magic byte), senza multipart.
- Health: percorso canonico `/api/health`, alias `/health` in nginx; l'healthcheck del container web usa una location statica.
- IP reale: in produzione l'API usa `CF-Connecting-IP` solo se è un IP valido e la richiesta ha attraversato tutta la catena di proxy (`req.ips.length >= TRUST_PROXY`), altrimenti `req.ip`; in locale `req.ip`. Negli log e nel DB l'IP compare solo come HMAC (`ip_hash`).
- nginx: immagine ufficiale `nginx:1.30.6-alpine3.24`, utente non-root, porta 8080, `proxy_pass` con variabile e `resolver 127.0.0.11` per risolvere di nuovo l'IP dell'API dopo un riavvio.
- cloudflared: immagine wrapper (alpine + binario statico + `entrypoint.sh` che attende il token), terza immagine GHCR `easysend-cloudflared`.
- Produzione: porta web pubblicata solo su 127.0.0.1 dell'LXC; `.env.example` imposta `COMPOSE_FILE=docker-compose.yml` per non caricare mai l'override di build.
- Limiti di memoria: api 768m (`--max-old-space-size=384`), web 128m, cloudflared 128m; in locale Mailpit aggiunge 128m.
- Migrazioni all'avvio: prima di ogni migrazione in sospeso su un DB non vuoto si fa un backup con `sqlite.backup()`, conservando gli ultimi 5.
- Stack DB: drizzle-orm 0.45 stabile con better-sqlite3 (binari precompilati musl); niente `node:sqlite`.
- Script multipiattaforma in `scripts/*.mjs`; `pnpm dev` è uno script Node, senza `concurrently`.
- release-please: `extra-files` aggiorna `version` nel `package.json` root.
- Direzione visiva "Netto e tecnico": shadcn `radix-lyra`, base `zinc`, raggio 0, IBM Plex Sans/Mono incluse nell'app (fontsource, niente Google Fonts), accento smeraldo verificato AA (`#047857` nel tema chiaro, emerald-400 nello scuro).
- UI responsive mobile-first: nessuno scroll orizzontale da 320px, controlli di almeno 44x44px, viewport senza blocco dello zoom; verifica a 375, 768, 1024 e 1440px.
- Toast con shadcn `sonner` dalla fase 5, collegato al nostro `ThemeProvider` (senza `next-themes`). Si usano per feedback transitori (link copiato, impostazioni salvate, trasferimento creato/revocato/eliminato, email di prova, upload completato, errori di azioni non legate a un campo); non per errori di validazione dei form (inline), errori bloccanti di pagina, né informazioni da conservare (codici di recupero, link appena creato). Accessibilità: `aria-live` (polite per i successi, assertive per gli errori), almeno 5 secondi, pausa su hover/focus, chiudibili da tastiera, in basso al centro su schermi stretti.
- Mittente sulla pagina di download: nome visualizzato facoltativo dell'utente (`display_name`, max 80 caratteri, modificabile dall'utente e dall'admin); se manca, la pagina mostra il nome dell'istanza. L'email del mittente non viene mai esposta.
- Primo admin: in produzione solo dal wizard (fase 4); in locale anche con `pnpm user:create-admin`, che si rifiuta con `APP_MODE` diverso da `local`.
- Sessioni: token casuale di 32 byte nel cookie `es_session` (HttpOnly, Secure, SameSite=Lax), nel DB solo lo SHA-256. Scadono dopo 7 giorni di inattività e comunque dopo 30; la sessione `mfa-pending` dura 10 minuti. Rotazione a login, completamento 2FA, cambio password e cambio ruolo; reset e cambio password revocano le altre sessioni. Cookie sempre `Secure` anche in locale: Chrome e Firefox li accettano su http://localhost, Safari no.
- Dipendenze auth: `@node-rs/argon2` (argon2id m=19 MiB, t=2, p=1), `otpauth`, `rate-limiter-flexible` (store in memoria, si azzera al riavvio), `cookie`, `nodemailer` (tipi inclusi). Nessuna libreria CSRF.
- CSRF fatto a mano: prima del login double-submit firmato (cookie `es_csrf`), dopo il login `HMAC(sessionId)`; header `X-CSRF-Token`, confronto in tempo costante. In più, sulle richieste non sicure si rifiutano `Origin` estranei o `null` e `Sec-Fetch-Site: cross-site`. Dopo un login che risponde `mfa_required`/`mfa_setup_required` il client chiede il nuovo token a `GET /api/auth/csrf`. Nella fase 3 il controllo cross-site va applicato anche a tus, montato prima dei body parser.
- Chiavi derivate con HKDF: da `APP_SECRET_KEY` `totp`, `smtp`, `file` (ricifrate dalla CLI di rotazione della fase 3); da `SESSION_SECRET` `csrf`, `ip-hash`, `download-cookie`, `setup-cookie`, `recovery-code`. I codici di recupero non dipendono dalla chiave master, così la sua rotazione non li invalida. Secret cifrati con AES-256-GCM nel formato `v1:<nonce>:<tag>:<ciphertext>`.
- 2FA: TOTP a 6 cifre, periodo 30 s, tolleranza ±1, anti-replay con `users.totp_last_counter`. 10 codici di recupero `xxxx-xxxx-xxxx` salvati come HMAC, monouso. L'admin non può disattivare il proprio 2FA; un admin senza 2FA al login riceve `mfa_setup_required`.
- Blocchi: 5 errori di login per account (anche email inesistenti, password o codici) bloccano 15 minuti con `ACCOUNT_LOCKED` e `Retry-After`; 20 per IP. Il contatore si azzera solo a login completo o reset password. Reset: 5/ora per IP e 3/ora per email (risposta sempre 202); conferma 10/ora per IP; ri-autenticazione (cambio password, disattivazione 2FA, nuovi codici) 5 errori per utente. Soglie in `apps/api/src/auth/policy.ts`.
- Email: lette e confrontate normalizzate (trim e minuscolo). Nella fase 2 le email sono testi semplici IT/EN (template definitivi nella fase 4); SMTP dalla tabella `settings` (valore cifrato) o, solo in locale, da `SMTP_DEV_HOST`/`SMTP_DEV_PORT` (Mailpit). Un utente creato senza password riceve un link di benvenuto valido 72 ore, gestito come un token di reset.
- Utenti eliminati: con `reassign` trasferimenti, upload e `used_bytes` passano all'altro utente; con `delete` le righe vengono rimosse e i file su disco li cancella il job di pulizia della fase 3. L'ultimo admin non si può degradare, disabilitare o eliminare; un admin non può eliminare se stesso.
- Ogni risposta JSON passa da `sendJson`, che la valida con lo schema del contratto (anche in produzione): i campi non previsti, come `password_hash`, non escono mai.
- Setup gate (`SETUP_REQUIRED`) rimandato alla fase 4 con il wizard.
- Cifratura dei file asincrona: il PATCH tus finale risponde subito 204, l'upload passa a `processing` e un worker interno (uno alla volta) calcola SHA-256 e cifra; `finalize` risponde `UPLOAD_INCOMPLETE` finché c'è un upload `in_progress`/`processing`; un HEAD su un upload `processing`/`completed` risponde `Upload-Offset = Upload-Length`; dopo un riavvio il worker riprende gli upload `processing` e cancella i `*.part`.
- Formato file cifrati v1: AES-256-GCM a segmenti da 64 KiB, record `ciphertext ‖ tag`, nonce = prefisso casuale 7 byte ‖ indice uint32 ‖ flag ultimo segmento (costruzione STREAM); chiave dati per file wrapped con la chiave `file` nel formato `v1:`.
- Zip in streaming senza compressione (store, ZIP64 automatico) con `Content-Length` calcolato; un file aperto alla volta.
- Limite di download stretto: raggiunto il limite si rifiutano anche le richieste Range (l'ultimo download consentito non si può riprendere).
- Pagina pubblica di download: `PUBLIC_URL/d/<token>`, token di 32 byte base64url. Cookie di sblocco `es_dl` = `exp.HMAC(transferId:exp:impronta del password_hash)`: cambiare o togliere la password invalida i cookie.
- `used_bytes` = somma delle dimensioni in chiaro dei file completati. Quota all'upload: `used_bytes + upload in_progress/processing + Upload-Length ≤ quota`; spazio: `libero − riserva ≥ 2 × dimensione`.
- Scadenza: `finalize` la ricalcola da quel momento con la stessa durata scelta alla creazione.
- Pulizia (ogni ora e all'avvio, mai due in parallelo): trasferimenti scaduti/revocati e bozze inattive eliminati da disco e DB (poi il link risponde `TRANSFER_NOT_FOUND`); upload scaduti; file orfani (storage più vecchi di 1 ora, tmp più vecchi del TTL); log oltre `LOG_RETENTION_DAYS`, token di reset e sessioni scadute; riallineamento di `used_bytes`. Gli upload `processing` non si toccano. Il job non scrive righe di audit, solo una riga di log riassuntiva. `CLEANUP_CRON` non valido blocca l'avvio.
- Eliminazione dei file: prima le righe DB in transazione, poi `unlink` best-effort; i fallimenti li recupera la pulizia degli orfani. Eliminare un utente rimuove subito i file; gli upload in corso vengono annullati sia con `delete` sia con `reassign`.
- Rate limit dei trasferimenti in `apps/api/src/transfers/policy.ts`: creazione e reinvio 30/ora per utente, download 600/10 min per IP, password dei link 10 errori/15 min per link+IP e 50/ora per link.
- Rotazione della chiave master: con chiave da file la nuova va in `secrets/app.key` e la vecchia resta in `app.key.previous`; con `APP_SECRET_KEY` la nuova viene scritta in `secrets/app.key.new` e va copiata nella variabile. Idempotente; un `app.key.new` rimasto si riprende con `--new-key-file`. La chiave non viene mai stampata.
- Dipendenze fase 3: `@tus/server`, `@tus/file-store`, `node-cron`, `yazl`; `yauzl` solo nei test. Non si usa `cleanUpExpiredUploads` di tus (cancellerebbe upload in elaborazione).
- Fase 4, ambito: oltre a wizard, Cloudflare ed email, la fase 4 implementa anche gli endpoint `settings.*` (impostazioni generali, SMTP, aspetto e immagini di branding), così la fase 5 resta solo frontend.
- Template email: componenti TSX nostri (`apps/api/src/mail/components.tsx`, layout a tabelle, bottone compatibile con Outlook) renderizzati con `react-dom/server`; React Email scartato perché i suoi pacchetti sono deprecati e `react-email` 6 è troppo pesante a runtime. HTML e testo nascono dagli stessi testi localizzati (`mail/content.ts`); il logo è un allegato inline CID (`cid:logo`): quello predefinito è un PNG ricavato da `docs/brand/easysend-horizontal.svg`, quello personalizzato è la variante `email-logo.png` di `logoLight`. Colori, raggio, footer e nome dell'istanza vengono dall'aspetto. Le email ai destinatari usano la lingua predefinita dell'istanza.
- Immagini di branding: sharp (libvips precompilato per musl), `cache(false)`, concorrenza 1, massimo 25 megapixel; magic byte e formato reale devono coincidere con il Content-Type; ricodifica sempre (metadati tolti, orientamento EXIF applicato). Limiti: loghi entro 800×200, favicon PNG 256×256, sfondo entro 2560×1440. File in `BRANDING_DIR`, metadati ed ETag nella chiave settings `branding_assets`; asset serviti con `Cache-Control: public, max-age=3600` e 304.
- URL pubblico a runtime: `ctx.publicUrl()` = variabile `PUBLIC_URL` se impostata, altrimenti setting `public_url` scritto dal passo Cloudflare, altrimenti il default locale. Lo usano CSRF (origine calcolata per richiesta), mailer, link di condivisione e avviso host locale.
- Setup gate: finché `setup_completed` non è vero ogni `/api/*` risponde 409 `SETUP_REQUIRED`, tranne health, `/api/setup/*`, `/api/public/settings`, `/api/assets/*`, `GET /api/auth/csrf` e `GET /api/auth/session`; il percorso è confrontato in minuscolo (Express non distingue maiuscole). Il passo admin del wizard risulta fatto se esiste già un admin (es. creato con la CLI in locale); `setup.admin` allora risponde `CONFLICT`.
- Codice di setup: 12 caratteri base32 (`XXXX-XXXX-XXXX`), solo in memoria come hash, stampato nei log (warn) a ogni avvio finché il setup non è completo; monouso; un tentativo con codice scaduto ne genera e stampa uno nuovo. Rate limit 10 errori/15 min per IP e 30/ora in totale (`apps/api/src/setup/policy.ts`). Cookie `es_setup` = `exp.HMAC(setup:exp)` con la chiave `setup-cookie`, `Path=/api/setup`, SameSite=Strict, 12 ore, cancellato da `setup.complete`.
- Iscrizione dell'admin in sospeso nel setting `setup_admin_pending`, cifrato per intero con la chiave `totp` (la CLI di rotazione lo ricifra); cancellato alla verifica.
- Prova SMTP: l'impronta SHA-256 delle impostazioni effettive (password compresa, quella salvata se omessa) provate con successo resta in memoria 30 minuti; il salvataggio senza prova risponde `SMTP_NOT_VERIFIED`. Destinatario: l'admin più vecchio (wizard) o l'admin che chiede (pannello). `SMTP_TEST_FAILED` espone solo codici sicuri (EAUTH, ECONNREFUSED, ETIMEDOUT...). Rate limit 10/ora per wizard e pannello.
- Cloudflare: client `fetch` nostro (nessun SDK), risposte validate con Zod, timeout 15 s, token API mai salvato né loggato. Un solo tunnel per istanza (`easysend-<hex casuale>`), riusato a ogni nuova configurazione, così il token del tunnel non cambia; prima controllo del record DNS (un record estraneo dà `CLOUDFLARE_RECORD_EXISTS` senza creare tunnel), poi ingress verso `http://web:8080`, CNAME proxied, token scritto in modo atomico in `SHARED_DIR/tunnel-token` (600). Un tunnel creato da un tentativo non finito è salvato con `configuredAt: 0` e non conta come configurato. Rate limit 10/ora. L'entrypoint di cloudflared riavvia il tunnel se il file del token cambia.
- `transfers.notified_at` significa solo "mittente avvisato del primo download" (prima lo scriveva anche l'invio ai destinatari e il mittente dei trasferimenti email non veniva mai avvisato); se l'invio fallisce torna NULL e il download successivo riprova.
- Compose di test `docker/docker-compose.test.yml` (progetto `easysend-test`): per ora solo Mailpit, usato da `pnpm test:mailpit` anche nel job CI `test`; nella fase 6 si aggiungono web e api per gli E2E.
