---
name: e2e-spec
description: Write or update an EasySend Playwright end-to-end test using the e2e/support helpers (TOTP with anti-replay, Mailpit, axe, composeExec, shared state) on the production-mode test stack. Use when a user flow is added or changed, or when an E2E test fails.
---

# Playwright E2E spec (EasySend)

The suite runs against a **production-mode** stack: `docker-compose.yml` + `docker/docker-compose.test.yml`
overlay (project `easysend-e2e`), web on http://localhost:18090, Mailpit API on :18025, fake
Cloudflare on :18787. `pnpm test:e2e` builds the images, runs project `setup` (wizard) then `e2e`
(files in order: `10-auth`, `20-transfer`, ... ), one worker, and tears the stack down.
Also apply the personal `webapp-testing` skill's method (reconnaissance, explicit waits, console
capture) with the Node Playwright of `e2e/` - no Python.

## Helpers (`e2e/support/`)

- `fixtures.ts`: import `test`/`expect` from here. An auto fixture fails the test on console
  errors, page errors and CSP violations; use `problems.allow(/regex/)` only for expected noise.
- `state.ts`: shared JSON state between spec files (admin email/password/TOTP secret, users).
- `totp.ts`: codes never reuse a 30 s window for the same secret (the server rejects replays);
  it may wait up to 30 s - keep logins few, reuse sessions.
- `mailpit.ts`: wait for a message by recipient and subject, read it, extract links.
- `compose.ts`: `composeExec(service, args)` (e.g. edit the DB in the api container with
  better-sqlite3), container logs, setup code.
- `a11y.ts`: `checkA11y(page, label)` - axe WCAG 2.2 AA, fails on serious/critical; it waits for
  running animations first. Call it on the main state of every page you visit.
- `files.ts`, `transfers.ts`, `ui.ts`, `zip.ts`: deterministic files on disk with SHA-256, transfer
  helpers, UI helpers (e.g. picking a Radix Select option), zip reading with yauzl.

## Writing a test

1. Reconnaissance: read the page component and the `it` i18n JSON for exact labels. The UI runs in
   `it-IT`. Prefer `getByRole`/`getByLabel` with exact names; `data-testid` only where it already
   exists (`file-input`, `resume-input`, `image-<kind>`).
2. shadcn/Radix specifics: a Select is a `combobox` button; open it, then click
   `page.getByRole('option', { name })` (options live in a portal, search on `page`); assert with
   `toHaveText`, never `selectOption`/`toHaveValue`. Visitor contexts must not inherit the admin
   storage state (use the session helper that drops it).
3. Time-dependent behaviour (expiry): change `expires_at` through `composeExec`, never sleep.
   Rate limits are real: use distinct emails, avoid more than 3 reset requests per email per hour.
4. Assert outcomes users see (texts, downloads with SHA-256, emails in Mailpit), not internals.
5. Run `pnpm test:e2e` until green twice in a row; `-- --keep` leaves the stack up for debugging,
   failures write container logs to `e2e/.output/logs` and traces to `e2e/.output/test-results`.
6. CI uses bundled Chromium (`PW_CHANNEL=chromium`), locally Edge: timing differs, so never rely on
   a toast or animation having disappeared - wait for explicit states.
