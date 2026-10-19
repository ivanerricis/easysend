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
- Conteggio download: conta ogni richiesta (file o zip) che parte dal byte 0; le richieste Range successive non contano; il primo conteggio fa partire la notifica.
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
