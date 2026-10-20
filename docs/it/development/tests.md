# Test

| Comando             | Cosa fa                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm lint`         | ESLint su tutto il repository, zero warning                                                                                                      |
| `pnpm typecheck`    | `tsc --noEmit` in ogni pacchetto                                                                                                                 |
| `pnpm test`         | test unitari Vitest di tutti i pacchetti                                                                                                         |
| `pnpm test:mailpit` | avvia Mailpit da `docker/docker-compose.test.yml`, invia le email vere e le controlla tramite la sua API                                         |
| `pnpm test:e2e`     | Playwright su uno stack in modalità produzione con API Cloudflare finta e Mailpit (progetto `easysend-e2e`, http://localhost:18090)              |
| `pnpm screenshots`  | stack isolato, completa il wizard e un trasferimento, salva gli screenshot chiaro/scuro in `docs/screenshots/`, fallisce su violazioni axe serie |

`pnpm test:e2e` e `pnpm screenshots` usano Microsoft Edge installato sul PC. Imposta `PW_CHANNEL=chromium` per usare invece il Chromium incluso in Playwright, come fa la CI.
