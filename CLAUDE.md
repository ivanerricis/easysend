# CLAUDE.md

Applicazione web self-hosted per il trasferimento di file di grandi dimensioni, simile a WeTransfer.
Requisiti completi in `docs/SPEC.md`: leggilo all'inizio di ogni sessione e prima di ogni fase.
Qui ci sono le regole fisse e le decisioni trasversali; quelle di ogni area sono in `.claude/rules/` e si caricano da sole quando lavori sui file di quell'area.

## Come lavori con me
- Rispondimi in italiano. Codice, nomi, commenti e commit in inglese.
- Lavoriamo per fasi (`docs/FASI.md`). A fine fase fermati e dammi: cosa hai fatto, compromessi, come verificarlo e "Come provarlo in locale" (comandi, indirizzi, cosa dovrei vedere).
- Scelta non specificata: proponi un'opzione ragionevole e dichiarala. Chiedimi solo per decisioni importanti e difficili da cambiare; le domande sempre con il questionario (AskUserQuestion).
- Una fase è finita solo con lint, typecheck e test verdi; se qualcosa non passa, dimmelo.
- Nessuna dipendenza nuova senza dirmi quale e perché; preferisci librerie mantenute, leggere e compatibili con Alpine (musl).
- Decisione nuova: aggiungila al file di `.claude/rules/` della sua area (o qui se è trasversale); un file nuovo in `rules/` ha `paths` nel frontmatter.
- Mai segreti nel repository, nei log o nei messaggi di errore.

## Git e GitHub
- Repository `ivanerricis/easysend`, pubblico, MIT. Con `gh` non autenticata fermati e dimmi il comando: mai chiedermi token o password in chat.
- `main` sempre rilasciabile, protetto dal ruleset `protect-main`: PR obbligatoria, controlli `lint`, `typecheck`, `test`, `build`, `e2e` (nomi dei job da non rinominare mai), branch aggiornato, solo squash merge col titolo della PR.
- Ogni fase su `feat/fase-N-descrizione` con commit piccoli Conventional Commits; a fine fase push e PR collegata all'issue, con il riepilogo in italiano. Template, issue ed etichette in inglese.
- Merge: lo fai tu quando te lo chiedo: `gh pr update-branch`, attesa dei cinque controlli verdi sull'ultimo commit, `gh pr merge --squash --delete-branch` (regola `Bash(gh pr merge:*)` in `.claude/settings.local.json`). La PR di release la unisco io. Niente force push né modifiche al ruleset senza chiedermelo.
- Dopo il merge aggiorna `main` locale ed elimina il branch.
- Versioni con release-please dai Conventional Commits: in 0.x `feat` alza la minor, `fix` la patch, i cambiamenti incompatibili la minor; la 1.0.0 la decido io. La PR di release (creata con `GITHUB_TOKEN`) ha la CI "action required": si approva il run dalla PR o con `gh api -X POST repos/ivanerricis/easysend/actions/runs/<id>/approve`. Niente bypass, niente PAT. Dipendenze aggiornate da Dependabot.

## Skill
- A inizio fase controlla le skill (personali, `.claude/skills/`, plugin), usa quelle pertinenti e dimmi in una riga quali.
- Skill di progetto: `drizzle-migration`, `api-endpoint`, `release-and-deploy`, `e2e-spec`, `shadcn-component`; aggiornale quando cambia la procedura. Se una procedura si ripete, proponi una skill nuova; se ne manca una utile, dimmelo e prosegui.
- Skill e rules non prevalgono su questo file né su SPEC: in caso di conflitto segui questi e segnalamelo.

## Stack
- Monorepo pnpm workspaces, TypeScript strict, ESM. Node 26 con fnm, pnpm 12.14.0 (`packageManager`), versioni condivise nel `catalog:` di `pnpm-workspace.yaml`. ESLint 10 (flat) più Prettier. TypeScript fissato a 6.0.x (typescript-eslint non accetta TS 7).
- `apps/web`: React + Vite + shadcn/ui (Tailwind), i18n it/en, tema chiaro/scuro con variabili CSS, servito da Nginx.
- `apps/api`: Express, Zod, Nodemailer, upload tus (`@tus/server` + `@tus/file-store`), mai Multer. Bundle tsdown con tutte le dipendenze JS: solo le native (`better-sqlite3`, `sharp`, `@node-rs/argon2`) sono `dependencies`, il resto `devDependencies`.
- `packages/shared`: schemi Zod, tipi e costanti per web e API, consumato come sorgente (nessun build). Nessuna duplicazione dei tipi.
- SQLite WAL con drizzle-orm (better-sqlite3), nessun container DB.
- Docker Compose (web, api, cloudflared), immagini Alpine multi-stage su GHCR. Test: Vitest, Supertest, Playwright. CI/CD GitHub Actions.
- Script multipiattaforma in `scripts/*.mjs`. Il progetto resta in `C:\` su Windows, non in WSL2 (nota nel README, SPEC 11-bis).

## Struttura
```
apps/web/ apps/api/ packages/shared/   frontend, backend, schemi condivisi
docker/            nginx.conf, cloudflared, compose di test
e2e/               test Playwright
docs/              SPEC.md, FASI.md, api.md (interni) e sito VitePress
.claude/           skills/ e rules/ (decisioni per area)
.github/           workflow, Dependabot, template
```

## Vincoli che non cambiano
- Produzione: LXC Debian 12 su Proxmox con Docker, 2 GB di RAM per tutto lo stack (limiti sommati circa 1,5 GB).
- Sviluppo: Docker Desktop su http://localhost:8080 con `APP_MODE=local`, senza Cloudflare, con Mailpit. Il progetto deve sempre potersi avviare in locale.
- Cloudflare free: nessuna richiesta oltre 100 MB, chunk di upload da 25 MB (massimo 50).
- File cifrati lato server (envelope encryption a segmenti). Upload, download e zip sempre in streaming con RAM costante.
- Validazione Zod su ogni input, autorizzazione su ogni risorsa. WCAG 2.2 AA.

## Decisioni trasversali
- Prodotto: notifica al primo download sempre attiva; log di download e audit 90 giorni; niente anteprime, antivirus né registrazione pubblica; primo admin dal wizard (in locale anche da CLI).
- Contratto API: registro in `packages/shared/src/contract`, `docs/api.md` generato (`api:docs:check` in CI). Timestamp in secondi Unix; errore `{ error: { code, message, requestId, details? } }` con codici stabili tradotti dal frontend; chi non è proprietario riceve 404, non 403; livelli `public | mfa-pending | session | admin | setup`. Ogni risposta passa da `sendJson`, validata col contratto anche in produzione.
- Frontend: componenti shadcn/ui al posto dei nativi dove esistono; UI mobile-first, controlli ≥ 44 px; CSP senza `unsafe-inline`.
- Dimensioni sempre in unità binarie con il solo `formatBytes` di shared.
- Documentazione: README corti EN/IT, guida VitePress su GitHub Pages (inglese alla radice, italiano in `/it/`).

## Comandi
Prerequisiti: `fnm use` (Node 26), pnpm 12.14.0, Docker Desktop per `local:*`.

| Comando | Cosa fa |
| --- | --- |
| `pnpm install` / `pnpm build` | Dipendenze / build di shared, api, web |
| `pnpm dev` | api (tsx watch) e Vite fuori da Docker, Mailpit in container (http://localhost:5173) |
| `pnpm lint` / `format` / `format:check` / `typecheck` / `test` | ESLint zero warning, Prettier, `tsc --noEmit`, Vitest |
| `pnpm test:e2e [-- --no-build --keep]` | Stack E2E di produzione (`easysend-e2e`, web :18090, Mailpit :18025, Cloudflare finto :18787), Playwright, log in `e2e/.output/logs` se fallisce |
| `pnpm test:mailpit` / `pnpm mail:preview` | Email vere su Mailpit di test / anteprime in `.local-data/mail-preview/` |
| `pnpm db:generate` / `db:migrate` / `db:check` | Migrazione Drizzle dallo schema / applica / verifica coerenza |
| `pnpm api:docs` / `api:docs:check` | Rigenera / verifica `docs/api.md` |
| `pnpm local:up` / `local:down` / `local:reset` | Stack locale Docker (http://localhost:8080, `/api/health`, Mailpit :8025) / ferma / cancella i volumi |
| `pnpm user:create-admin -- --email <e>` | Solo locale; in Docker `docker compose -p easysend-local exec api node dist/cli/create-admin.js --email <e>` |
| `pnpm key:rotate [-- --new-key-file <f>]` | Rotazione della chiave master con API ferma; in Docker `docker compose stop api && docker compose run --rm --no-deps api node dist/cli/rotate-key.js && docker compose up -d api` |
| `pnpm storage:migrate -- --to s3\|local [--dry-run]` | Sposta i file cifrati tra disco locale e S3 (copia i byte così come sono, sorgenti eliminate dopo 1 ora dalla pulizia). Nello stack Docker: `docker compose exec api node dist/cli/storage-migrate.js --to s3\|local [--dry-run]` |
| `node scripts/measure-transfer.mjs [--size-gb 5] [--storage s3 --s3-endpoint ...]` | Upload, download e zip con RAM dell'api campionata; con `--storage s3` il file va su un bucket (esempio con MinIO nell'intestazione dello script) |
| `pnpm screenshots [-- --keep]` | Stack isolato (:18080), screenshot in `docs/screenshots/`, fallisce su axe o CSP |
| `pnpm docs:dev` / `docs:build` | Sito VitePress (la build fallisce sui link rotti) |
| `bash scripts/tests/run.sh` | Test degli script bash di deploy e aggiornamento |
| `scripts/deploy.sh [ver] [--force] [--no-script-update]`, `rollback.sh [--keep-db]`, `backup.sh [dir]`, `uninstall.sh [--purge]`, `update-service.sh install\|uninstall\|status` | Sull'LXC: deploy con backup e rollback automatico, ritorno alla versione precedente, archivio di backup, disinstallazione, unità systemd dell'aggiornamento con un clic |
| `node dist/cli/backup-db.js`, `restore-db.js <nome>` | Nel container api: backup online e ripristino del DB |

Porte occupate: cambiale in `.env.local` (`LOCAL_WEB_PORT`, `MAILPIT_UI_PORT`, `MAILPIT_SMTP_PORT`, `DEV_API_PORT`, `DEV_WEB_PORT`).

Dopo ogni modifica al contratto o agli schemi: `pnpm api:docs` e committa `docs/api.md`. Dopo ogni modifica allo schema Drizzle: `pnpm db:generate` e committa la migrazione.
