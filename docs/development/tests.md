# Tests

| Command             | What it does                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`         | ESLint on the whole repository, zero warnings                                                                                            |
| `pnpm typecheck`    | `tsc --noEmit` in every package                                                                                                          |
| `pnpm test`         | Vitest unit tests of all packages                                                                                                        |
| `pnpm test:mailpit` | starts Mailpit from `docker/docker-compose.test.yml`, sends the real emails, checks them through its API                                 |
| `pnpm test:e2e`     | Playwright against a production-mode stack with a fake Cloudflare API and Mailpit (project `easysend-e2e`, http://localhost:18090)       |
| `pnpm screenshots`  | isolated stack, runs the wizard and a transfer, saves light and dark screenshots to `docs/screenshots/`, fails on serious axe violations |

`pnpm test:e2e` and `pnpm screenshots` use the Microsoft Edge installed on your PC. Set `PW_CHANNEL=chromium` to use the Chromium bundled with Playwright instead, as CI does.
