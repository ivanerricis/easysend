# Introduzione

EasySend è un'applicazione web self-hosted per inviare file di grandi dimensioni, simile a WeTransfer. La esegui sul tuo server, dietro un Cloudflare Tunnel, quindi non si apre nessuna porta in ingresso.

![Pagina di nuovo trasferimento](../../screenshots/06-new-transfer-light.png)

## Panoramica

- Upload ripristinabili di file molto grandi con il protocollo [tus](https://tus.io), a blocchi da 25 MB (il piano gratuito di Cloudflare rifiuta le richieste oltre 100 MB).
- I file sono cifrati sul disco del server (AES-256-GCM). Upload, download e zip sono in streaming, quindi la RAM non cresce con la dimensione del file.
- Condivisione con link o con email. Scadenza a 3 giorni, 1 settimana o 1 mese. Password e limite di download facoltativi. Un trasferimento si può revocare in qualsiasi momento.
- Il mittente riceve un avviso al primo download.
- Utenti con ruoli (admin, utente) e quote per utente. L'autenticazione a due fattori (TOTP) è obbligatoria per gli admin.
- Interfaccia in italiano e inglese, tema chiaro e scuro, branding configurabile (nome, loghi, colori, sfondo, footer).
- Wizard di setup: account admin, SMTP, tunnel Cloudflare e impostazioni generali. Nessun file di configurazione da modificare a mano.
- Nessuna anteprima dei file, nessun antivirus integrato, nessuna registrazione pubblica (vedi [Note di sicurezza](./security)).

| Pagina di download                                                      | Admin: utenti                                               |
| ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| ![Pagina di download](../../screenshots/11-download-unlocked-light.png) | ![Admin utenti](../../screenshots/13-admin-users-light.png) |

Altri screenshot (chiari e scuri) sono in [docs/screenshots](https://github.com/ivanerricis/easysend/tree/main/docs/screenshots).

## Architettura

```text
Browser --HTTPS--> Cloudflare --Tunnel--> cloudflared
                                              |
                                              v
                                   web (nginx + React)
                                              |  /api
                                              v
                                       api (Express)
                                         |         |
                                         v         v
                                  SQLite (WAL)   file cifrati
```

| Container     | Contenuto                                                                   | Limite di memoria |
| ------------- | --------------------------------------------------------------------------- | ----------------- |
| `web`         | nginx che serve l'app React e inoltra `/api` all'api                        | 128 MB            |
| `api`         | Express, server di upload tus, database SQLite (WAL), archivio file cifrati | 768 MB            |
| `cloudflared` | Client del Cloudflare Tunnel (profilo `tunnel`)                             | 128 MB            |

I dati stanno in due volumi Docker: `easysend-data` (database, file cifrati, branding, segreti) e `easysend-shared` (il token del tunnel scritto dal wizard e letto da `cloudflared`).
