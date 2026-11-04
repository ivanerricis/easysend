---
paths:
  - 'apps/api/src/auth/**'
  - 'apps/api/src/http/**'
  - 'apps/api/src/users/**'
  - 'apps/api/src/crypto/**'
  - 'apps/api/src/cli/**'
  - 'apps/api/src/app.ts'
  - 'apps/api/src/audit.ts'
  - 'apps/api/src/logger.ts'
  - 'apps/api/src/secrets.ts'
  - 'apps/api/src/routes/{auth,me,admin-users}.ts'
  - 'apps/web/src/pages/{auth,profile}/**'
---

# Autenticazione, sicurezza e log

- Sessioni: 32 byte casuali nel cookie `es_session` (HttpOnly, Secure, SameSite=Lax), nel DB lo SHA-256. Scadenza 7 giorni di inattività, massimo 30; `mfa-pending` 10 minuti. Rotazione a login, 2FA completato, cambio password e ruolo; reset e cambio password revocano le altre sessioni. `Secure` anche in locale (Chrome e Firefox lo accettano su localhost, Safari no).
- CSRF a mano, nessuna libreria: prima del login double-submit firmato (`es_csrf`), dopo `HMAC(sessionId)`; header `X-CSRF-Token`, confronto in tempo costante. Sulle richieste non sicure si rifiutano `Origin` estranei o `null` e `Sec-Fetch-Site: cross-site`; `rejectCrossSite` gira una volta per richiesta (anche su tus, montato prima dei body parser). Dopo `mfa_required`/`mfa_setup_required` il client richiede il token a `GET /api/auth/csrf`.
- HKDF: da `APP_SECRET_KEY` `totp`, `smtp`, `file`; da `SESSION_SECRET` `csrf`, `ip-hash`, `download-cookie`, `setup-cookie`, `recovery-code` (i codici di recupero non dipendono dalla chiave master). Secret cifrati AES-256-GCM `v1:<nonce>:<tag>:<ciphertext>`.
- Password argon2id (`@node-rs/argon2`, m=19 MiB, t=2, p=1). 2FA (`otpauth`): TOTP 6 cifre, 30 s, ±1, anti-replay `users.totp_last_counter`; 10 codici `xxxx-xxxx-xxxx` come HMAC, monouso. L'admin non disattiva il proprio 2FA; admin senza 2FA riceve `mfa_setup_required`.
- Blocchi (`auth/policy.ts`, `rate-limiter-flexible` in memoria, azzerato al riavvio): 5 errori di login per account (anche inesistente) = 15 minuti `ACCOUNT_LOCKED` con `Retry-After`, 20 per IP; azzerati solo da login completo o reset. Reset 5/ora per IP e 3/ora per email (sempre 202), conferma 10/ora per IP, ri-autenticazione 5 errori per utente.
- Email lette e confrontate normalizzate (trim, minuscolo).
- Utenti: l'ultimo admin non si degrada, disabilita né elimina; un admin non elimina se stesso. Utente creato senza password: link di benvenuto di 72 ore (token di reset). Eliminazione: rimuove subito i file e annulla gli upload in corso; `reassign` sposta trasferimenti, upload, richieste e `used_bytes`, `delete` li cancella.
- Primo admin: in produzione solo dal wizard; in locale anche `create-admin` (rifiuta `APP_MODE` diverso da `local`, chiede la password due volte se manca `--password`).
- Cookie firmati `<exp>.<mac>` con `http/signed-cookie.ts`; audit con `auditRequest` (`audit.ts`).
- IP reale: in produzione `CF-Connecting-IP` solo se valido e con tutta la catena di proxy (`req.ips.length >= TRUST_PROXY`), altrimenti `req.ip`. Nei log e nel DB solo `ip_hash` (HMAC).
- Log senza dati personali: `pino-http` con id, metodo, URL senza query e con i token mascherati (`/d/`, `/r/`, `/api/r/`), status; nginx con lo stesso mascheramento e senza IP, referer, user agent.
- Rotazione chiave master: da file la nuova va in `secrets/app.key`, la vecchia in `app.key.previous`; con `APP_SECRET_KEY` la nuova va in `secrets/app.key.new` da copiare nella variabile. Idempotente, ripresa con `--new-key-file`, mai stampata. Ricifra chiavi dei file, TOTP, `setup_admin_pending` e tutte le impostazioni in `ENCRYPTED_KEYS`.
- CLI di backup: `backup-db` (`manual-<ts>.sqlite`, ultimi 10) e `restore-db` (solo `manual-*`/`app-pre-*`, `integrity_check`, salva prima `app-pre-restore-*`).
