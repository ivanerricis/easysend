# Prompt delle fasi

Incolla un prompt alla volta in Claude Code. Ogni fase si chiude con una pull request: controlla il riepilogo, verifica che la CI sia verde, fai tu il merge e poi passa alla fase successiva.
Ogni fase vale come conclusa solo se lint, typecheck e test passano.

---

## Fase 0 — Repository GitHub e flusso di lavoro
Leggi CLAUDE.md e docs/SPEC.md. Controlla le skill disponibili e dimmi quali userai in questa fase.
Verifica i prerequisiti (SPEC 15.1). Se manca qualcosa, fermati e dammi i comandi da eseguire.
Fammi le domande della sezione 15.2 in un unico messaggio e aspetta le risposte.
Poi crea il repository e applica le impostazioni (15.3): primo commit, protezione di `main`, etichette, template, milestone e un'issue per ogni fase.
Aggiungi uno scheletro di `ci.yml` con job che per ora eseguono solo i controlli di base, in modo da avere già i controlli obbligatori su `main`. Configura Dependabot (15.5) e release-please (15.4) con prima versione 0.1.0.
Alla fine dammi il link al repository, l'elenco di cosa hai impostato e cosa non è stato possibile impostare (con il motivo).

## Fase 1 — Fondamenta e contratto API
Controlla le skill disponibili e usa quelle pertinenti. Lavora sul branch `feat/fase-1-fondamenta`.
Crea il monorepo pnpm (apps/web, apps/api, packages/shared), configurazione TypeScript strict, lint e formattazione, Dockerfile Alpine multi-stage per web e api, docker-compose.yml con cloudflared (entrypoint che attende il token in SHARED_DIR), docker-compose.override.yml per la build locale, nginx.conf (SPEC sezione 2), .env.example (sezione 11).
Scrivi lo schema Drizzle completo (sezione 12) e la prima migrazione.
Genera docs/api.md (sezione 13) con gli schemi Zod in packages/shared.
Prepara l'esecuzione in locale (sezione 11-bis): docker-compose.local.yml con Mailpit, profilo `tunnel` per cloudflared, .env.local.example, .gitattributes, comandi `local:up`, `local:down`, `local:reset` e `dev`. Verifica che lo stack parta su Docker Desktop e che /health risponda su http://localhost:8080.
Completa `ci.yml` con lint, typecheck, test e build delle immagini. Aggiorna la sezione "Comandi" di CLAUDE.md.
Apri la pull request e fermati: aspetta che approvi il contratto API prima di qualsiasi implementazione.

## Fase 2 — Autenticazione e utenti
Controlla le skill disponibili e usa quelle pertinenti. Lavora sul branch `feat/fase-2-auth`.
Implementa nel backend: sessioni, CSRF, rate limiting, login con 2FA TOTP e codici di recupero, password dimenticata via email (senza ancora i template definitivi), ruoli, gestione utenti da parte dell'admin, quote (SPEC sezioni 7 e 10).
Test Vitest e Supertest per ogni flusso, incluso l'accesso negato alle risorse di altri utenti.
Apri la pull request collegata all'issue della fase.

## Fase 3 — Upload, cifratura, download e pulizia
Controlla le skill disponibili e usa quelle pertinenti. Lavora sul branch `feat/fase-3-trasferimenti`.
Implementa l'upload tus con gli hook (sezione 3), la cifratura a segmenti (sezione 4), i trasferimenti con link ed email, password, limite di download e revoca (sezione 5), il download in streaming con Range e lo zip in streaming, il job di pulizia e la conservazione dei log (sezione 6).
Test obbligatori della sezione 4, test del flusso tus con ripresa, test delle scadenze. Misura l'uso di RAM durante un upload e un download di un file da almeno 5 GB e riporta i numeri nella pull request.
Apri la pull request collegata all'issue della fase.

## Fase 4 — Wizard di setup, Cloudflare ed email
Controlla le skill disponibili e usa quelle pertinenti. Lavora sul branch `feat/fase-4-setup`.
Implementa il wizard (sezione 9) lato backend, l'integrazione con le API Cloudflare (tunnel, ingress, record DNS) e SMTP con email di prova. Crea i template email HTML e testo, localizzati e con il branding (sezione 2): invio link, notifica al primo download, password dimenticata, benvenuto per i nuovi utenti.
Test con le API Cloudflare simulate e con Mailpit. Aggiungi Mailpit al compose di test usato dalla CI.
Apri la pull request collegata all'issue della fase.

## Fase 5 — Frontend
Controlla le skill disponibili e usa quelle di design frontend e accessibilità prima di scrivere l'interfaccia. Lavora sul branch `feat/fase-5-frontend`.
Proponimi una direzione visiva breve prima di implementare tutte le pagine.
Pagine: wizard di setup, login con 2FA, password dimenticata, upload con trascinamento e avanzamento, i miei trasferimenti, pagina pubblica di download (con password), profilo (password, 2FA, lingua, tema), pannello admin (utenti, trasferimenti, spazio, impostazioni) e sezione Aspetto con anteprima dal vivo (sezione 8).
Usa i tipi e gli schemi di packages/shared per form e chiamate API. i18n italiano e inglese completo, tema chiaro e scuro, WCAG 2.2 AA.
Apri la pull request collegata all'issue della fase, con screenshot delle pagine principali in entrambi i temi.

## Fase 6 — Hardening, test E2E, release e deploy
Controlla le skill disponibili e usa quelle per test web, sicurezza, Docker, CI/CD e documentazione. Lavora sul branch `feat/fase-6-release`.
Rivedi la sicurezza con la checklist della sezione 10 e correggi quanto trovi. Ottimizza le immagini e mostrami le dimensioni finali e il consumo di RAM a riposo e sotto carico.
Scrivi i test Playwright (sezione 14) e aggiungili a `ci.yml`. Completa `security.yml` e `publish.yml` (sezione 15.4) e implementa il metodo di deploy scelto nella fase 0 (sezione 15.7).
Scrivi README in italiano e inglese, CONTRIBUTING.md e SECURITY.md (sezioni 16 e 17).
Apri la pull request. Dopo il mio merge, verifica il flusso completo della sezione 15.8 e prepara la release v0.1.0 lasciando a me il merge della pull request di release.
Infine proponimi quali procedure ripetute vale la pena salvare come skill di progetto in .claude/skills/.

## Fase 7 — Aggiornamento con un clic
Controlla le skill disponibili e usa quelle pertinenti. Lavora sul branch `feat/fase-7-one-click-update` (issue #17).
Permetti a un admin di aggiornare EasySend dal pannello (Impostazioni → Aggiornamenti) senza SSH, ma senza dare al container il socket Docker né alcun accesso all'host. L'API scrive soltanto un file di richiesta (`updates/request`: id, versione, ora) nella cartella condivisa `./updates` (montata in `/updates`, variabile `UPDATE_DIR`); un'unità systemd path sull'LXC (`easysend-update.path` → `easysend-update.service`, utente proprietario della cartella di installazione, gruppo docker, con `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full`, `ProtectHome=read-only`) avvia `scripts/update-runner.sh`, che valida la richiesta, esegue `deploy.sh <versione> --yes` e riporta l'avanzamento in `updates/status.json`; l'output va in `.deploy/update.log` (ne restano 5). `scripts/update-service.sh install|uninstall|status [--user U]` installa e rimuove le unità; `uninstall.sh` le rimuove.
Endpoint `admin.updateRun` (stato) e `admin.updateStart` (avvio): solo admin, CSRF, 5 richieste/ora, audit `system.update_requested`, solo una release ufficiale pubblicata (non bozza né pre-release) più recente di quella in uso, ricontrollata su GitHub. Una richiesta non presa in carico entro 2 minuti risulta "non risponde"; uno stato `running` fermo da 45 minuti non blocca più. In modalità locale la funzione non è disponibile. Interfaccia: scelta della versione, finestra di conferma, avanzamento in tempo reale che sopravvive al riavvio, esito (aggiornato con ricarica, ripristinato, fallito con il percorso del log). Nessun pulsante di rollback.
Codici di uscita di `deploy.sh`: 75 occupato, 20 compose, 21 backup, 30 ripristinato, 31 rollback fallito. Test degli script in `scripts/tests/run.sh` (passo "Update scripts" del job `test` della CI), test API e frontend, E2E dove possibile.
Documenta la funzione nel sito (aggiornamenti e sicurezza, IT/EN), compresa la nota per chi parte dalla 0.1.x: il vecchio `deploy.sh` non scarica i due nuovi script, che vanno presi una volta a mano.
Apri la pull request collegata all'issue della fase.

## Fase 8 — Link per ricevere file (completata)
Controlla le skill disponibili e usa quelle pertinenti. Lavora sul branch `feat/fase-8-upload-requests` (issue #35).
Permetti a un utente di creare una richiesta ("Ricevi file") e di condividerne il link pubblico `/r/<token>`: chi lo apre carica file senza account, con lo stesso upload tus (a chunk, ripristinabile) e la stessa cifratura dei trasferimenti normali. Opzioni: titolo, istruzioni, scadenza, password, dimensione massima totale, numero massimo di invii, nome ed email di chi carica obbligatori; modifica, revoca ed eliminazione dal proprietario. I file arrivano come trasferimenti ricevuti (`source = received`), visibili in Trasferimenti con il filtro Inviati/Ricevuti, con mittente e messaggio, senza reinvio né notifica di primo download; il proprietario riceve un'email a ogni invio completato.
Dati: tabella `upload_requests` e colonne `source`, `upload_request_id`, `sender_name`, `sender_email` in `transfers`. Sicurezza: cookie `es_ru` per la password, token di invio in `X-Submission-Token` su tus e finalize, CSRF, limiti di frequenza, token mascherati nei log. Endpoint `requests.*` (proprietario) e `submissions.*` (pubblico).
Test API (Supertest), frontend (Vitest) ed E2E (`70-upload-request.spec.ts`: creazione, sblocco anonimo, invio di due file, email, zip con SHA-256, limite di dimensione, revoca, axe). Documenta la funzione nel sito (Ricevere file, IT/EN), in SPEC e nel README.
Apri la pull request collegata all'issue della fase.

## Fase 9 — Archiviazione S3 facoltativa
Controlla le skill disponibili e usa quelle pertinenti. Lavora sul branch `feat/fase-9-storage-s3`.
Permetti di salvare i file cifrati su un servizio compatibile S3 (Cloudflare R2, MinIO, AWS S3, Backblaze B2, Wasabi) invece che sul disco locale, che resta il predefinito. Pacchetti di lavoro: (1) motore: interfaccia `StorageDriver`, colonna `transfer_files.storage`, driver locale, coda `storage_deletions`, regola di spazio 1× con S3; (2) driver S3 su `aws4fetch` (PutObject e multipart, letture a intervalli, ripresa e pulizia dei multipart); (3) API admin e setup: impostazione `storage` cifrata, import del `.env` solo al primo avvio, prova prima di salvare, `STORAGE_IN_USE`, job di migrazione nei due sensi con avanzamento, annullamento e ripresa dopo il riavvio, CLI `storage:migrate`; (4) interfaccia: Impostazioni → Archiviazione con scheda di spostamento, passo facoltativo "Dove salvare i file" nel wizard, IT/EN, axe; (5) E2E contro MinIO nel compose di test, screenshot, misura della RAM, documentazione (guida IT/EN "Archiviazione S3", SPEC, README, regole in `.claude/rules/storage.md`).
Test API e unitari con un S3 simulato, frontend (Vitest) ed E2E (`80-storage-s3.spec.ts`: prova con chiave sbagliata, salvataggio, trasferimento su S3 con oggetti nel bucket e righe `storage = 's3'`, download e zip con SHA-256, spostamento sul disco locale, axe). Misura upload, download e zip di un file da 1 GB su MinIO e confrontala con il disco locale. Nessuna dipendenza nuova oltre a `aws4fetch`.
Apri la pull request collegata all'issue della fase.

## Fase 10 — Cartelle nei trasferimenti
Controlla le skill disponibili e usa quelle pertinenti. Lavora sul branch `feat/fase-10-folders`.
Permetti di inviare intere cartelle mantenendo la struttura, sia nei trasferimenti sia nei link per ricevere file. Pacchetti di lavoro: (1) API: colonna `transfer_files.path` (migrazione 0004), metadato tus `relativePath` ripulito (`sanitizeRelativeDir`), zip che ricrea le cartelle (`dedupeZipEntries`), nome foglia nel download del singolo file, impostazione admin `general.maxFilesPerTransfer` (1..5000, predefinito 1000); (2) interfaccia: scelta e trascinamento di cartelle, selezione raggruppata, `FileTree` nella pagina di download e nel dettaglio, impostazione nelle Impostazioni generali, IT/EN, axe; (3) E2E (`90-folders.spec.ts`: cartella annidata con `.DS_Store`, albero, file singolo e zip con SHA-256, limite dell'admin, pagina "Ricevi file"), screenshot e documentazione (guida IT/EN "Inviare file", SPEC, regole in `.claude/rules`).
Test API e unitari (`folders.test.ts`), frontend (Vitest) ed E2E. Nessuna dipendenza nuova.
Apri la pull request collegata all'issue della fase (#56).
