---
paths:
  - 'apps/api/src/requests/**'
  - 'apps/api/src/routes/{requests,submissions}.ts'
  - 'apps/api/src/uploads/**'
  - 'apps/web/src/pages/{requests,submit}/**'
  - 'packages/shared/src/schemas/requests.ts'
---

# Richieste di file (fase 8)

- API: proprietario `requests.*` (altri, admin compresi, 404 `REQUEST_NOT_FOUND`), pubblico `submissions.*` sotto `/api/r/:token`. `expired` derivato da `expires_at`; revoca e scadenza fermano subito invii, chunk e finalize (l'annullamento resta possibile).
- Password come i link: cookie `es_ru` = `exp.HMAC(request:<id>:exp:impronta)` (`download-cookie`, `Path=/api/r/<token>`, Strict, 1 ora); errori contati da `http/link-password.ts`.
- Invio anonimo: `submissions.create` crea una bozza `source='received'` del proprietario e restituisce `submissionToken` = `exp.HMAC(submission:<transferId>:exp)` (12 ore) da mandare in `X-Submission-Token` su tus, `get`, `finalize`, `cancel`; token sbagliato o assente = 404. tus ha un solo "uploader scope" (sessione o token, `transferId` deve coincidere); una sessione non riempie né finalizza una bozza `received`.
- Limiti: `received_bytes` + bozze + upload in volo + nuovo file ≤ `max_total_bytes` (413 `REQUEST_SIZE_LIMIT`); `max_submissions` alla creazione e atomico al finalize (`REQUEST_FULL`).
- Finalize: scadenza = `expires_in` della richiesta da quel momento, contatori con un UPDATE condizionato, audit `request.submission_received` senza attore, email al proprietario nella sua lingua. Nessuna notifica di primo download né reinvio; le bozze `received` non compaiono negli elenchi.
- Frequenza (`transfers/policy.ts`): creazione richieste 30/ora per utente, vista pubblica 600/10 min per IP, invii 20/ora per IP e 100/ora per richiesta, password 10/15 min per richiesta+IP e 50/ora, creazioni tus anonime 200/ora per IP.
- Frontend: namespace `requests` e `submit`, voce "Ricevi file", filtro Inviati/Ricevuti; link appena creato mostrato in pagina, non in toast. `/r/:token` (`pages/submit/`) riusa `UnlockCard`, `Dropzone`, `SelectedFiles`, `ResumeBanner`, `UploadProgressPanel` e `features/upload/runner.ts` con le chiamate `submissions` iniettate; chunk da `submissions.info`; bozza in localStorage per token.
