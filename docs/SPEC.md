# Specifiche del progetto

Documento di riferimento completo. Le regole di lavoro sono in `CLAUDE.md`, le fasi in `docs/FASI.md`.

## 1. Obiettivi e vincoli generali
- Architettura a 3 livelli: frontend, backend, database.
- Deploy con Docker Compose, esposizione pubblica tramite Cloudflare Tunnel (nessuna porta aperta sul router).
- Ambiente: container LXC Debian 12 su Proxmox con Docker installato dentro (nesting attivo), 2 GB di RAM per l'intero stack. Imposta mem_limit e cpus per ogni servizio in modo che il totale resti sotto circa 1,5 GB.
- App leggera: immagini Alpine, multi-stage build, utente non-root, filesystem read-only dove possibile, healthcheck, .dockerignore, versioni delle immagini fissate, solo dipendenze necessarie.
- Interfaccia in italiano e inglese (i18n, selettore lingua, lingua predefinita in base al browser). Anche le email sono localizzate.
- Target: pochi utenti contemporanei (uso personale o piccola attività).
- Due ambienti, scelti con APP_MODE:
  - `local`: prova sul PC di sviluppo su http://localhost:8080, senza Cloudflare né dominio, con Mailpit al posto di un vero server SMTP.
  - `production`: LXC con Cloudflare Tunnel e dominio pubblico.
  Il codice è lo stesso; cambiano solo variabili d'ambiente e servizi avviati nel compose.
- Accessibilità WCAG 2.2 AA: navigazione completa da tastiera, focus visibile, contrasti adeguati in entrambi i temi, etichette e annunci per screen reader (anche per la barra di avanzamento dell'upload), rispetto di prefers-reduced-motion.

## 2. Stack tecnologico
- Monorepo pnpm workspaces: `apps/web`, `apps/api`, `packages/shared`.
- `packages/shared`: schemi Zod di richieste e risposte, tipi derivati, costanti (opzioni di scadenza, limiti). Usato da frontend e backend.
- Frontend: React, Vite, TypeScript, shadcn/ui (Tailwind). Servito da Nginx nel container web.
- Backend: Node.js + Express + TypeScript, Zod, Nodemailer, `@tus/server` con `@tus/file-store` montato su /api/uploads.
- Nginx: serve i file statici e fa da reverse proxy verso il backend su /api. client_max_body_size 50m su /api/uploads, proxy_request_buffering off, proxy_buffering off per i download, timeout adeguati, header di sicurezza (CSP, X-Content-Type-Options, Referrer-Policy, Permissions-Policy). Header tus (Upload-Offset, Upload-Length, Tus-Resumable, Location) inoltrati ed esposti correttamente.
- Database: SQLite (WAL) con Drizzle ORM, migrazioni versionate eseguite all'avvio, file del DB in un volume dedicato.
- Cloudflare Tunnel: container cloudflared nello stesso compose.
- Email: template HTML responsive con versione solo testo, localizzati, con il branding dell'istanza (proponi React Email o MJML e motiva la scelta).
- Se una dipendenza nativa dà problemi su Alpine (musl), usa alternative pure JS o con binari precompilati e spiegami la scelta.

## 3. Trasferimento file
- Upload con protocollo tus tramite `tus-js-client` nel browser: chunk da 25 MB di default (configurabile, mai oltre 50 MB per il limite di 100 MB per richiesta di Cloudflare free), ripresa dopo interruzione, refresh o cambio di rete. Barra di progresso con velocità e tempo stimato.
- Hook di tus:
  - onIncomingRequest: verifica sessione autenticata e CSRF.
  - onUploadCreate: valida i metadati con Zod, controlla quota utente e spazio disco, crea la riga in `uploads`.
  - onUploadFinish: calcola SHA-256, cifra il file nello storage definitivo (vedi sezione 4), cancella subito il file in chiaro, aggiorna il database.
- Limite massimo: nessun limite fisso per file. Il limite è lo spazio libero su disco (fs.statfs) meno una riserva configurabile (default 1 GB). Siccome la cifratura richiede temporaneamente il doppio dello spazio, alla creazione dell'upload servono almeno 2 volte la dimensione del file più la riserva. Errore chiaro se non basta.
- Più file nello stesso trasferimento. Il destinatario può scaricare i singoli file o tutto come zip generato in streaming (decifratura e compressione al volo, niente zip su disco, RAM costante).
- Download in streaming con supporto agli header Range, Content-Disposition corretto, nome file originale ripristinato.
- Sui file in storage nomi casuali (UUID), mai il nome originale. Sanifica i nomi per evitare path traversal e caratteri pericolosi.
- Upload incompleti scaduti dopo 24 ore (estensione expiration di tus e pulizia periodica).
- Nessuna anteprima dei file: la pagina di download mostra elenco, dimensioni e pulsanti di download.

## 4. Cifratura dei file su disco
- Envelope encryption: ogni file ha una chiave dati casuale da 256 bit, cifrata (wrapped) con una chiave master derivata da APP_SECRET_KEY tramite HKDF. Usa chiavi derivate separate per file, TOTP e segreti SMTP.
- Algoritmo: AES-256-GCM a segmenti di dimensione fissa (es. 64 KB), ciascuno con proprio nonce derivato dal prefisso del file e dal numero di segmento, e con tag di autenticazione. Così si possono servire le richieste Range decifrando solo i segmenti necessari e si rileva qualsiasi manomissione.
- Usa solo il modulo crypto di Node, nessuna crittografia scritta a mano oltre allo schema a segmenti.
- Il file in chiaro esiste solo nella cartella temporanea di tus e solo fino al termine della cifratura. Dichiara questo compromesso nel README.
- Rotazione della chiave master: deve richiedere solo di ricifrare le chiavi dati, non i file. Prevedi un comando CLI dedicato.
- Test obbligatori: cifratura e decifratura complete, richieste Range a cavallo di segmenti, file vuoti, rilevamento di un segmento alterato.

## 5. Condivisione
Due modalità, entrambe con scadenza obbligatoria a scelta tra 3 giorni, 1 settimana, 1 mese:
1. Link: URL condivisibile con token lungo e casuale (non indovinabile).
2. Email: il mittente inserisce uno o più destinatari e un messaggio opzionale. Nodemailer invia il link.
Opzioni per ogni trasferimento: password opzionale sul link (hash forte, mai in chiaro), limite massimo di download opzionale, revoca in qualsiasi momento da parte del proprietario.
Notifica sempre attiva: il mittente riceve un'email al primo download di ogni trasferimento, senza possibilità di disattivarla. SMTP è quindi obbligatorio nel setup.
I destinatari NON hanno bisogno di un account. La pagina di download mostra nome, dimensione, scadenza e conteggio dei download.

## 6. Scadenza e pulizia automatica
- Job schedulato nel backend (node-cron, ogni ora) che elimina trasferimenti scaduti, link revocati e upload incompleti, sia su disco sia nel database.
- Lo stesso job elimina le righe di download_logs e audit_log più vecchie di LOG_RETENTION_DAYS (default 90) e i token di reset password scaduti.
- Il controllo di scadenza va fatto ANCHE a ogni richiesta di download.
- Eliminazione sicura rispetto agli errori: se la cancellazione di un file fallisce, riprova al ciclo successivo e logga l'errore.

## 7. Utenti, ruoli e autenticazione
- Nessuna registrazione pubblica: gli utenti li crea solo l'admin.
- Ruoli: admin e utente normale.
- Admin: crea ed elimina utenti, resetta 2FA di un utente (dispositivo perso), vede tutti i trasferimenti, elimina o modifica i link degli altri (cambio scadenza, revoca), vede lo spazio usato/libero, imposta le quote, gestisce le impostazioni di aspetto. Quando elimina un utente sceglie se eliminare anche i suoi file o riassegnarli.
- Quote: quota di spazio opzionale per utente (vuota = nessun limite oltre lo spazio libero). Upload rifiutato con messaggio chiaro se la quota verrebbe superata. L'utente vede il proprio spazio usato.
- Utente normale: carica file, gestisce solo i propri trasferimenti, cambia password, attiva/disattiva il 2FA, sceglie lingua e tema.
- Password dimenticata: dalla pagina di login l'utente richiede un link via email, monouso, valido PASSWORD_RESET_TTL_MINUTES (default 30). La risposta non rivela se l'email esiste. Il token è salvato solo come hash. Il reset invalida tutte le sessioni dell'utente e NON disattiva il 2FA (per l'admin il 2FA resta richiesto al login). Rate limit su richiesta e utilizzo.
- 2FA con TOTP (QR code + secret in chiaro come alternativa) e codici di recupero monouso. Opzionale per gli utenti, OBBLIGATORIO per l'admin e configurato nel primo setup.
- Password con argon2id (o bcrypt se argon2 dà problemi su Alpine), lunghezza minima, sessioni con cookie httpOnly + Secure + SameSite, protezione CSRF, rate limiting e blocco temporaneo sui login falliti.
- Secret TOTP e password SMTP cifrati nel database.

## 8. Impostazioni di aspetto (pannello admin)
Sezione "Aspetto" nelle impostazioni admin (senza anteprima dal vivo né verifica del contrasto: rimosse nella fase 6, le modifiche si vedono sulle pagine dopo il salvataggio):
- Nome dell'istanza e testo del footer.
- Logo per tema chiaro e tema scuro, favicon, immagine di sfondo opzionale per le pagine pubbliche (login e download). Accetta solo PNG, JPEG e WebP con limite di dimensione, verifica il tipo reale del file, ridimensiona lato server. Niente SVG caricati dagli utenti (rischio XSS).
- Colore principale e colore di accento: applicati tramite le variabili CSS di shadcn/ui. Calcola automaticamente il colore del testo in contrasto.
- Arrotondamento degli angoli (raggio dei componenti) e font tra un piccolo elenco di font inclusi nell'app (niente font esterni, per privacy e prestazioni).
- Tema predefinito: chiaro, scuro o automatico secondo il sistema. Ogni utente può sovrascriverlo nel proprio profilo; nelle pagine pubbliche c'è un interruttore.
- Pulsante "ripristina predefiniti".
- Le stesse impostazioni (nome, logo, colori) si applicano ai template email.
- Asset serviti dal backend con cache e ETag, salvati in BRANDING_DIR.

## 9. Primo setup (wizard)
Al primo avvio l'app mostra un wizard, eseguibile una sola volta:
1. Protezione: all'avvio il backend stampa nei log un codice di setup monouso (valido SETUP_CODE_TTL_MINUTES) da inserire nel wizard.
2. Creazione dell'admin (email, password) con 2FA obbligatorio (QR code + verifica del primo codice + codici di recupero).
3. SMTP (host, porta, TLS, utente, password, mittente) con "invia email di prova". Non si prosegue finché la prova non riesce.
4. Dominio e Cloudflare: il wizard chiede il dominio e un API token Cloudflare con permessi minimi (Account > Cloudflare Tunnel: Edit, Zone > DNS: Edit, Zone > Zone: Read) e mostra come crearlo. Tramite API il backend crea il tunnel, configura l'ingress verso il container web e crea il record DNS CNAME proxied. Il dominio deve essere già gestito da Cloudflare. Il token API non viene salvato. Il token del tunnel viene scritto in SHARED_DIR, e l'entrypoint di cloudflared attende il file prima di avviarsi (niente Docker socket). Errori chiari (token non valido, zona non trovata, record già esistente) con possibilità di riprovare.
5. Impostazioni generali: nome dell'istanza, riserva disco, dimensione dei chunk, lingua predefinita, tema predefinito.
Finché il setup non è completo, le altre rotte reindirizzano al wizard.

Comportamento con APP_MODE=local:
- Il codice di setup viene comunque stampato nei log (il flusso resta identico a quello di produzione).
- Il passaggio 3 propone i dati di Mailpit già compilati (host mailpit, porta 1025, senza TLS né autenticazione); l'email di prova si verifica nell'interfaccia di Mailpit.
- Il passaggio 4 (Cloudflare) viene saltato con un avviso. L'URL pubblico è PUBLIC_URL.
- Nel pannello admin esiste comunque una sezione "Dominio e tunnel" per configurare Cloudflare in un secondo momento, con la stessa logica del passaggio 4.

## 10. Sicurezza
- Validazione Zod di body, query e parametri su ogni endpoint, con gli schemi di `packages/shared`.
- Rate limiting su login, reset password, creazione trasferimenti, tentativi di password sui link e download.
- Header di sicurezza, CORS ristretto al dominio configurato, trust proxy corretto, IP reale da CF-Connecting-IP.
- Autorizzazione verificata su ogni risorsa.
- File serviti sempre come attachment con Content-Type application/octet-stream, mai interpretati.
- Log strutturati (accessi, creazioni, download, eliminazioni, azioni admin) senza dati sensibili, IP solo come hash, con rotazione.
- Segreti solo in variabili d'ambiente o file generati nel volume dati, mai nel repository.
- Nessun antivirus integrato: nota nel README su come aggiungerlo in futuro.

## 11. Variabili d'ambiente
Nell'ambiente vanno solo i parametri di avvio. Tutto ciò che si configura nel wizard o nel pannello admin sta nella tabella settings. Fornisci un .env.example commentato:
- APP_MODE (local|production, default production) e PUBLIC_URL (es. http://localhost:8080 in locale; in produzione viene impostato dal wizard in base al dominio).
- TZ (default Europe/Rome), NODE_ENV (production), PORT (3000, interna), LOG_LEVEL (info), TRUST_PROXY (1 in locale con solo Nginx, 2 in produzione con cloudflared + Nginx).
- DATA_DIR (/data), DB_PATH (/data/db/app.sqlite), STORAGE_DIR (/data/storage), TMP_UPLOAD_DIR (/data/tmp, stesso filesystem di STORAGE_DIR), BRANDING_DIR (/data/branding), SHARED_DIR (/shared).
- APP_SECRET_KEY: chiave master a 32 byte. Se assente viene generata al primo avvio in /data/secrets/app.key (permessi 600). Il README deve dire chiaramente di includerla nel backup: senza, file, secret TOTP e password SMTP non sono più leggibili.
- SESSION_SECRET: stesso meccanismo.
- SETUP_CODE_TTL_MINUTES (60), PASSWORD_RESET_TTL_MINUTES (30), LOG_RETENTION_DAYS (90), INCOMPLETE_UPLOAD_TTL_HOURS (24), CLEANUP_CRON ("0 * * * *").
- DEFAULT_DISK_RESERVE_MB (1024), DEFAULT_CHUNK_SIZE_MB (25): usati solo prima del wizard.
Il token API Cloudflare non è una variabile d'ambiente.

## 11-bis. Esecuzione in locale
Due modi, entrambi documentati nel README e funzionanti dalla fase 1:
- Prova completa con Docker: `docker-compose.local.yml` (da usare insieme a docker-compose.yml) che costruisce le immagini in locale, imposta APP_MODE=local, espone il frontend solo su 127.0.0.1:8080, aggiunge Mailpit con interfaccia su 127.0.0.1:8025 e non avvia cloudflared. cloudflared sta nel profilo compose `tunnel`, attivo solo in produzione. Fornisci un `.env.local.example` pronto all'uso e un comando unico (es. `pnpm local:up`, `pnpm local:down`, `pnpm local:reset` che cancella i volumi locali).
- Sviluppo con ricaricamento automatico: `pnpm dev` avvia backend e frontend fuori da Docker (Vite su localhost:5173 con proxy verso /api), e solo Mailpit in un container. I dati vanno in una cartella `.local-data/` esclusa da git.
- I browser accettano i cookie Secure su http://localhost, quindi le sessioni funzionano senza HTTPS. In modalità locale l'app va aperta solo da localhost, non dall'IP della rete locale. Se all'avvio rileva una richiesta da un host diverso da PUBLIC_URL, lo segnala nei log.
- I test E2E e la CI usano la stessa configurazione locale.
- Il PC di sviluppo usa Docker Desktop. Il setup deve funzionare su Windows (con WSL2), macOS e Linux:
  - `.gitattributes` che forza fine riga LF per script, Dockerfile, entrypoint e file di configurazione, altrimenti su Windows gli script nei container non partono.
  - Script del progetto multipiattaforma (comandi pnpm o Node, non solo bash). Gli script pensati per l'LXC possono restare in bash.
  - Su Windows il README consiglia di tenere il progetto nel filesystem di WSL2 (es. ~/progetti) e non in C:\, per prestazioni dei volumi e permessi corretti.
  - In locale lo spazio libero rilevato dall'app è quello del disco virtuale di Docker Desktop, non del PC: il README lo spiega e indica come aumentarlo.

## 12. Schema del database (Drizzle, SQLite)
Id testuali casuali, timestamp in secondi Unix, PRAGMA foreign_keys=ON, journal_mode=WAL, busy_timeout, indici sui campi di ricerca.
- settings: key (PK), value (JSON), is_encrypted, updated_at. Include setup_completed e le impostazioni di aspetto.
- users: id, email (unica), password_hash, role (admin|user), totp_secret_enc, totp_enabled, quota_bytes (nullable), used_bytes, locale, theme_preference (light|dark|system|null), disabled, created_at, last_login_at.
- recovery_codes: id, user_id (FK cascade), code_hash, used_at.
- password_reset_tokens: id, user_id (FK cascade), token_hash (unico), expires_at, used_at, created_at.
- sessions: id (hash del token), user_id (FK cascade), expires_at, created_at, ip_hash, user_agent, mfa_verified.
- transfers: id, owner_id (FK), token (unico), title, message, mode (link|email), expires_at, password_hash, max_downloads, download_count, total_bytes, status (uploading|active|revoked|expired|deleted), created_at, first_downloaded_at, notified_at.
- transfer_files: id, transfer_id (FK cascade), original_name, storage_name, size_bytes (in chiaro), stored_size_bytes, mime_type, sha256, enc_key_wrapped, enc_nonce_prefix, enc_segment_size, enc_version, created_at.
- transfer_recipients: id, transfer_id (FK cascade), email, notified_at.
- uploads: id (id dell'upload tus), owner_id (FK), transfer_id (FK, nullable fino al completamento), file_name, total_size, status (in_progress|completed|aborted), created_at, last_activity_at, expires_at.
- download_logs: id, transfer_id (FK cascade), file_id, ip_hash, user_agent, bytes_sent, created_at.
- audit_log: id, actor_id, action, target_type, target_id, metadata (JSON senza dati sensibili), ip_hash, created_at.
Regole:
- Eliminare un trasferimento elimina a cascata file, destinatari e log; i file su disco si cancellano da codice con retry.
- used_bytes si aggiorna in transazione a ogni completamento ed eliminazione e viene riallineato dal job di pulizia.
- Prima di ogni migrazione che modifica dati, copia di backup del file SQLite.

## 13. Contratto API
Nella fase 1 genera `docs/api.md` con tutti gli endpoint (metodo, percorso, autenticazione richiesta, schema Zod di richiesta e risposta, codici di errore), derivato dagli schemi di `packages/shared`. Fermati e aspetta la mia approvazione prima di implementarlo.

## 14. Test
- Vitest per la logica (scadenze, quote, cifratura, autorizzazioni, token di reset).
- Supertest per le API, incluso il flusso tus completo con ripresa.
- Playwright per gli E2E: setup iniziale (API Cloudflare simulate), login con 2FA, upload multiplo con interruzione e ripresa, link con password, download e zip, scadenza, password dimenticata, pannello admin, impostazioni di aspetto, controlli di accessibilità automatici (axe).
- Compose di test con Mailpit per intercettare le email.

## 15. Repository GitHub e flusso CI/CD

### 15.1 Prerequisiti (verifica all'inizio della fase 0)
- `git` configurato con nome ed email, `gh` installata e autenticata (`gh auth status`) con gli scope repo e workflow.
- Se qualcosa manca, fermati e dammi i comandi da eseguire io (es. `gh auth login`, `gh auth refresh -s workflow`). Non chiedere mai token in chat e non salvarli su file.

### 15.2 Domande da farmi prima di creare il repository
Fammi queste domande in un unico messaggio, proponendo per ognuna un'opzione predefinita:
- Nome del repository e account o organizzazione proprietaria.
- Visibilità: pubblico o privato. Spiegami le conseguenze: sul piano GitHub Free, protezione dei branch e ruleset sui repository privati non sono disponibili; con immagini GHCR private, l'LXC deve autenticarsi con un token read:packages per scaricarle.
- Licenza (es. MIT, AGPL-3.0, nessuna se privato).
- Metodo di deploy sull'LXC (vedi 15.7).

### 15.3 Creazione e impostazioni del repository
- Crea il repository con `gh repo create`, descrizione e topic, collegalo al progetto locale e fai il primo commit (struttura minima, .gitignore, .editorconfig, licenza, README provvisorio, CLAUDE.md, docs/).
- Impostazioni tramite `gh` o API: solo squash merge, eliminazione automatica dei branch dopo il merge, wiki disattivata, Dependabot alerts e security updates attivi, secret scanning e push protection se disponibili per la visibilità scelta.
- Protezione di `main` (ruleset o branch protection, se disponibile): pull request obbligatoria, controlli CI obbligatori, branch aggiornato prima del merge, niente force push né cancellazione. Se non è disponibile sul piano, dimmelo e prosegui.
- Etichette (feature, fix, security, docs, ci, dependencies, fase-0 ... fase-6), template per issue (bug, richiesta funzione) e per pull request (riepilogo, come verificare, checklist).
- Una milestone "v0.1.0" e un'issue per ogni fase di docs/FASI.md, con i criteri di completamento come checklist. Ogni pull request chiude la sua issue (`Closes #N`).

### 15.4 Workflow GitHub Actions
Regole comuni: permessi minimi dichiarati per ogni job, azioni di terze parti fissate allo SHA del commit, concurrency che annulla le esecuzioni superate, cache di pnpm e cache di Docker Buildx (type=gha), timeout per ogni job.
- `ci.yml` (push e pull request): installazione, lint, typecheck, test unitari e API, build delle immagini senza push, test E2E Playwright sul compose di test con Mailpit (report caricato come artifact in caso di errore). I nomi dei job devono essere stabili perché sono i controlli obbligatori su `main`.
- `security.yml` (pull request e settimanale): scansione delle immagini con Trivy (fallisce su vulnerabilità critiche con fix disponibile), audit delle dipendenze, CodeQL se disponibile per la visibilità scelta.
- `release-please.yml` (push su `main`): mantiene una pull request di release con changelog generato dai Conventional Commits e versione semver. Quando la unisco, crea tag e GitHub Release.
- Versionamento: la prima release è 0.1.0. Configura release-please (file di configurazione e manifest) in modo che la prima versione proposta sia esattamente 0.1.0 e verificalo nella pull request di release generata. Finché il progetto è in 0.x attiva bump-minor-pre-major: un cambiamento incompatibile alza la minor (0.2.0) e non porta a 1.0.0. Il passaggio a 1.0.0 lo decido io in un secondo momento.
- La pull request di release resta aperta durante lo sviluppo: non va unita prima della fine della fase 6, salvo mia decisione.
- `publish.yml` (alla pubblicazione di una release): build e push su GHCR delle immagini web e api con tag versione, versione minore, `latest` e sha, label OCI (sorgente, versione, licenza), attestazione di provenienza della build, scansione Trivy dell'immagine pubblicata. Usa solo il GITHUB_TOKEN con permesso packages: write, nessun segreto aggiuntivo.
- Il docker-compose.yml di produzione usa le immagini GHCR con versione fissata; docker-compose.override.yml permette la build locale.

### 15.5 Dependabot
- `.github/dependabot.yml` per npm (workspace pnpm), Docker (immagini base) e GitHub Actions, con cadenza settimanale, raggruppamento delle patch e delle minor, etichetta dependencies.
- Le pull request di Dependabot passano dalla stessa CI. Nessun merge automatico: le approvo io.

### 15.6 Segreti
- Nessun segreto nel repository. Se un workflow avesse bisogno di un segreto, impostalo con `gh secret set` facendomelo inserire da terminale, mai in chiaro nei comandi che scrivi.

### 15.7 Deploy sull'LXC
Il docker-compose.yml di produzione legge la versione delle immagini da una variabile APP_VERSION nel file `.env` (es. `ghcr.io/<owner>/<repo>-api:${APP_VERSION}`), mai `latest`. Aggiornare significa cambiare APP_VERSION.
Nella fase 0 proponimi le opzioni con pro e contro e fammi scegliere, poi implementa quella scelta nella fase 6:
- Manuale: script `scripts/deploy.sh <versione>` sull'LXC (senza argomento usa l'ultima release, letta dalle API di GitHub) che salva la versione attuale per il rollback, fa backup del DB, aggiorna APP_VERSION in `.env`, esegue `docker compose pull` e `up -d`, controlla /health e, se il controllo fallisce, ripristina la versione e il backup precedenti. Prevedi anche `scripts/rollback.sh`.
- Semiautomatico: lo stesso script eseguito da un timer systemd che controlla se esiste una nuova release.
- Automatico: runner self-hosted di GitHub Actions sull'LXC che esegue lo script alla pubblicazione di una release (spiegami i rischi di sicurezza, soprattutto con repository pubblico).

### 15.8 Prima release
A fine fase 6: verifica che l'intero flusso funzioni dall'inizio alla fine (pull request, CI verde, merge, pull request di release, tag, immagini su GHCR, deploy di prova) e prepara la release v0.1.0 lasciando a me il merge.

## 16. Backup e manutenzione
- Cosa salvare: volume del DB, volume dei file, cartella secrets (chiave master), branding, configurazione. Backup consistente del DB con il comando .backup di SQLite, non copia a caldo.
- Procedura di ripristino e di aggiornamento secondo il metodo di deploy scelto (sezione 15.7).
- Endpoint /health.
- Parametri dell'LXC per Docker (nesting, keyctl) e attenzioni sullo spazio disco.

## 17. Deliverable
- Repository completo secondo la struttura in CLAUDE.md, Dockerfile per ogni servizio, nginx.conf, .env.example.
- README in italiano e inglese: requisiti, preparazione dell'LXC, installazione, primo setup, token Cloudflare, backup/ripristino, aggiornamento e deploy, rotazione della chiave, risoluzione dei problemi.
- CONTRIBUTING.md con il flusso di lavoro (branch, Conventional Commits, pull request, release) e SECURITY.md con le istruzioni per segnalare vulnerabilità.
