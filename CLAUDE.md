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
Definiscili nella fase 1 e scrivili qui (install, dev, lint, typecheck, test, test:e2e, build, db:migrate).

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
- La PR di release creata con GITHUB_TOKEN non avvia la CI: il workflow di release-please la lancia con `workflow_dispatch` sul branch della PR (niente bypass, niente PAT).
- Lingua su GitHub: template, issue ed etichette in inglese; riepiloghi di fase nelle PR in italiano.
- Il progetto resta in `C:\` su Windows (non in WSL2); nel README va la nota di SPEC 11-bis.
