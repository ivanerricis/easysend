---
paths:
  - 'e2e/**'
  - '.github/**'
  - 'docker/docker-compose.test.yml'
  - '**/*.test.ts'
  - '**/*.test.tsx'
  - 'apps/api/test/**'
  - 'docs/.vitepress/**'
  - 'release-please-config.json'
  - 'package.json'
  - 'pnpm-workspace.yaml'
---

# Test, CI, dipendenze e pubblicazione

- Compose di test `docker/docker-compose.test.yml`, overlay di quello di produzione (`APP_VERSION=e2e`) con Mailpit e Cloudflare finto (`e2e/fake-cloudflare/server.ts`, riusa `apps/api/test/fake-cloudflare.ts` con lo stripping dei tipi di Node). E2E in `APP_MODE=production` con `CLOUDFLARE_API_BASE` e `UPDATE_CHECK_URL` verso il finto e `CLEANUP_CRON` annuale; `pnpm test:mailpit` (progetto `easysend-test`) avvia solo Mailpit.
- E2E: pacchetto `@easysend/e2e` senza script `test`, specs in `e2e/tests/` (progetti `setup` poi `e2e`, un worker), helper in `e2e/support/` (TOTP con anti-replay su file di stato, Mailpit, axe, fixture che fallisce su errori di console e CSP, `composeExec`); scadenza provata spostando `expires_at` nel DB del container. CI con Chromium di Playwright (`PW_CHANNEL=chromium`), in locale Edge. Screenshot PNG in `docs/screenshots/`, riusati nel README.
- CI: sulle PR solo di documentazione (`docs/`, Markdown, `LICENSE`, template) il job `e2e` risulta verde saltando build e Playwright; i push su `main` eseguono tutto.
- Scansioni: Trivy come immagine `aquasec/trivy` fissata al digest (non `trivy-action`, i cui tag sono stati compromessi), fallisce solo su CRITICAL con correzione; CodeQL per JS/TS e Actions; `security.yml` sulle PR e ogni lunedì, non obbligatorio.
- Pubblicazione: `publish.yml` chiamato da `release-please.yml` alla nascita di una release (quelle di `GITHUB_TOKEN` non scatenano `release: published`) o a mano con un tag; solo amd64, tag `X.Y.Z`, `X.Y`, `latest`, `sha-…`, label OCI, provenance, SBOM, attestazione, Trivy dopo il push. release-please tipo `simple`, `extra-files` aggiorna il `package.json` root; la 0.1.0 è uscita il 2026-10-20 con `release-as`, poi rimosso.
- Audit: `pnpm audit --audit-level high` su tutte le dipendenze (non solo `--prod`, l'API le include nel bundle). Prima `overrides` verso la versione corretta (`body-parser`, `systeminformation`); solo gli avvisi senza correzione e fuori dalle immagini in `auditConfig.ignoreGhsas` con il motivo. Dipendenze opzionali Redis di tus in `ignoredOptionalDependencies`. VitePress 1.x: override `vitepress>vite` a vite 6.4.x, da togliere con VitePress 2.
- Documentazione: README corti (EN e IT), guida VitePress in `docs/` (`@easysend/docs`, inglese alla radice, italiano in `/it/`) su GitHub Pages dal workflow `docs.yml`; `SPEC.md`, `FASI.md` e `api.md` esclusi dal sito; link rotti = build fallita.
- Fixture E2E: oltre a errori di console e CSP fallisce su dialog (`role=dialog|alertdialog`) con overflow orizzontale, misurato 400 ms dopo l'apertura.
