---
paths:
  - 'apps/api/src/setup/**'
  - 'apps/api/src/settings/**'
  - 'apps/api/src/mail/**'
  - 'apps/api/src/branding/**'
  - 'apps/api/src/cloudflare/**'
  - 'apps/api/src/routes/{setup,settings,admin-tunnel}.ts'
  - 'apps/web/src/pages/{setup,settings-forms}/**'
  - 'apps/web/src/pages/admin/settings/**'
  - 'docker/cloudflared/**'
---

# Setup, impostazioni, email e Cloudflare

## Setup

- Setup gate: finché `setup_completed` non è vero ogni `/api/*` risponde 409 `SETUP_REQUIRED`, tranne health, `/api/setup/*`, `/api/public/settings`, `/api/assets/*`, `GET /api/auth/csrf` e `/api/auth/session` (percorso confrontato in minuscolo). Passo admin fatto se un admin esiste già (`setup.admin` = `CONFLICT`).
- Codice di setup: 12 caratteri base32 `XXXX-XXXX-XXXX`, in memoria come hash, stampato (warn) a ogni avvio finché il setup non è completo, monouso, rigenerato se scaduto. Limiti 10 errori/15 min per IP e 30/ora (`setup/policy.ts`). Cookie `es_setup` = `exp.HMAC(setup:exp)` (`setup-cookie`, `Path=/api/setup`, Strict, 12 ore), cancellato da `setup.complete`.
- Iscrizione admin in sospeso nel setting `setup_admin_pending`, cifrato con la chiave `totp`, cancellato alla verifica.

## Impostazioni

- Cache in memoria nel repository delle impostazioni, svuotata da `set`/`delete` (un solo processo; le CLI girano con l'API ferma). Un nuovo setting cifrato va in `ENCRYPTED_KEYS` (rotazione della chiave).
- Prova SMTP: impronta SHA-256 delle impostazioni provate con successo (password compresa, quella salvata se omessa) in memoria 30 minuti; senza prova `SMTP_NOT_VERIFIED`. Destinatario: admin più vecchio (wizard) o chi chiede (pannello). `SMTP_TEST_FAILED` solo con codici sicuri (EAUTH, ECONNREFUSED, ETIMEDOUT...). 10/ora.
- Branding: upload con corpo raw (png/jpeg/webp), sharp (`cache(false)`, concorrenza 1, max 25 MP), magic byte e formato reale coerenti col Content-Type, sempre ricodificato (metadati tolti, EXIF applicato). Loghi entro 800×200, favicon PNG 256×256, sfondo entro 2560×1440. File in `BRANDING_DIR`, metadati ed ETag nel setting `branding_assets`; serviti con `max-age=3600` e 304.
- Avviso di aggiornamento disattivabile con `updateCheck` nelle impostazioni generali.

## Email

- Template TSX nostri (`mail/components.tsx`, tabelle, bottone compatibile Outlook) con `react-dom/server`; React Email scartato (deprecato e pesante). Un solo template `mail/templates/standard.tsx` (dettagli e messaggio facoltativi); HTML e testo dagli stessi testi (`mail/content.ts`).
- Logo inline CID (`cid:logo`): predefinito PNG da `docs/brand/easysend-horizontal.svg`, personalizzato = variante `email-logo.png` di `logoLight`. Colori, raggio, footer e nome dall'aspetto. Destinatari nella lingua predefinita dell'istanza, proprietari nella propria.
- SMTP dal setting cifrato o, solo in locale, da `SMTP_DEV_HOST`/`SMTP_DEV_PORT` (Mailpit). Dimensioni con il solo `formatBytes` di shared (unità binarie).

## Cloudflare

- Client `fetch` nostro, risposte Zod, timeout 15 s, token API mai salvato né loggato. Un tunnel per istanza (`easysend-<hex>`), riusato, così il token non cambia. Prima il controllo DNS (record estraneo = `CLOUDFLARE_RECORD_EXISTS` senza creare tunnel), poi ingress `http://web:8080`, CNAME proxied, token scritto atomico in `SHARED_DIR/tunnel-token` (600). Tentativo non finito salvato con `configuredAt: 0`. 10/ora. cloudflared (immagine wrapper con `entrypoint.sh` che attende il token) riavvia il tunnel se il file cambia.
- Cambio di dominio: dopo una configurazione riuscita si elimina best effort il vecchio CNAME solo se punta a `<tunnelId>.cfargotunnel.com` del nostro tunnel; un errore dà log warn e `previousRecord: 'failed'` senza far fallire. La risposta ha `previousHostname`/`previousRecord` (`removed | not_found | failed`) solo se l'hostname è cambiato. `GET /api/admin/tunnel` espone `publicUrlEnv`: se diverso da `https://<hostname>` la pagina avvisa.
