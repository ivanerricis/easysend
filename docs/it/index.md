---
layout: home
title: EasySend
titleTemplate: Trasferimento di file grandi self-hosted

hero:
  name: EasySend
  text: Invia file grandi dal tuo server
  tagline: Un'alternativa self-hosted a WeTransfer con upload ripristinabili, cifratura a riposo e Cloudflare Tunnel, quindi nessuna porta in ingresso aperta.
  image:
    src: /favicon.svg
    alt: Logo di EasySend
  actions:
    - theme: brand
      text: Inizia
      link: /it/guide/install
    - theme: alt
      text: Introduzione
      link: /it/guide/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/ivanerricis/easysend

features:
  - title: Upload ripristinabili
    details: File molto grandi con il protocollo tus, a blocchi da 25 MB, entro i limiti del piano gratuito di Cloudflare.
  - title: Cifrati a riposo
    details: AES-256-GCM sul disco del server. Upload, download e zip sono in streaming, quindi la RAM non cresce con la dimensione del file.
  - title: Link con controlli
    details: Condivisione con link o email. Scadenza, password e limite di download facoltativi. Un trasferimento si può revocare in qualsiasi momento.
  - title: Utenti e 2FA
    details: Ruoli admin e utente, quote per utente, autenticazione a due fattori TOTP obbligatoria per gli admin.
  - title: Wizard di setup
    details: Account admin, SMTP, tunnel Cloudflare e impostazioni generali. Nessun file di configurazione da modificare a mano.
  - title: Leggero
    details: Tutto lo stack sta in circa 1 GB di limiti di memoria. Interfaccia in italiano e inglese, tema chiaro e scuro, branding personalizzabile.
---

<div class="home-shot">

![Pagina di nuovo trasferimento](../screenshots/06-new-transfer-light.png)

</div>
