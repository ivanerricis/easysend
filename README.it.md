# EasySend

[English](README.md) | Italiano

EasySend è un'applicazione web self-hosted per inviare file di grandi dimensioni, simile a WeTransfer. La esegui sul tuo server, dietro un Cloudflare Tunnel, quindi non si apre nessuna porta in ingresso.

![Pagina di nuovo trasferimento](docs/screenshots/06-new-transfer-light.png)

| Pagina di download                                                     | Admin: utenti                                              |
| ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| ![Pagina di download](docs/screenshots/11-download-unlocked-light.png) | ![Admin utenti](docs/screenshots/13-admin-users-light.png) |

## Funzioni

- Upload ripristinabili di file molto grandi con il protocollo [tus](https://tus.io), a blocchi da 25 MB.
- File cifrati su disco (AES-256-GCM). Upload, download e zip sono in streaming, quindi la RAM non cresce con la dimensione del file.
- Condivisione con link o email, con scadenza, password e limite di download facoltativi. Revoca in qualsiasi momento.
- Utenti con ruoli e quote, autenticazione a due fattori obbligatoria per gli admin.
- Interfaccia in italiano e inglese, tema chiaro e scuro, branding configurabile.
- Wizard di setup per admin, SMTP, tunnel Cloudflare e impostazioni generali.

## Avvio rapido

Su un LXC Debian 12 (o qualsiasi host Linux) con Docker e il plugin Compose. La guida completa, con la preparazione dell'LXC, è nella [documentazione](https://ivanerricis.github.io/easysend/it/guide/install).

```sh
sudo mkdir -p /opt/easysend && sudo chown "$USER": /opt/easysend && cd /opt/easysend
V=0.1.0; RAW=https://raw.githubusercontent.com/ivanerricis/easysend/v$V; mkdir -p scripts/lib
curl -fsSL -o docker-compose.yml $RAW/docker-compose.yml && curl -fsSL -o .env.example $RAW/.env.example
for f in deploy.sh rollback.sh backup.sh uninstall.sh lib/common.sh; do curl -fsSL -o scripts/$f $RAW/scripts/$f; done
chmod +x scripts/*.sh && cp .env.example .env && chmod 600 .env
./scripts/deploy.sh
```

Poi apri un tunnel SSH dal tuo PC (`ssh -L 8080:127.0.0.1:8080 <utente>@<indirizzo-lxc>`), vai su http://localhost:8080 e segui il wizard di setup. Il codice di setup è nel log dell'api: `docker compose logs api | grep "Setup code"`.

## Documentazione

Documentazione completa: **https://ivanerricis.github.io/easysend/it/** (disponibile anche in [inglese](https://ivanerricis.github.io/easysend/)).

- [Introduzione e architettura](https://ivanerricis.github.io/easysend/it/guide/introduction)
- [Requisiti](https://ivanerricis.github.io/easysend/it/guide/requirements) e [preparazione dell'LXC](https://ivanerricis.github.io/easysend/it/guide/lxc)
- [Installazione](https://ivanerricis.github.io/easysend/it/guide/install) e [primo setup](https://ivanerricis.github.io/easysend/it/guide/first-setup)
- [Token API di Cloudflare](https://ivanerricis.github.io/easysend/it/guide/cloudflare)
- [Backup e ripristino](https://ivanerricis.github.io/easysend/it/guide/backup)
- [Aggiornamento e rollback](https://ivanerricis.github.io/easysend/it/guide/updates)
- [Note di sicurezza](https://ivanerricis.github.io/easysend/it/guide/security) e [risoluzione dei problemi](https://ivanerricis.github.io/easysend/it/guide/troubleshooting)

## Sviluppo

Node 26 e pnpm 12.14.0 (`fnm use` sceglie il Node giusto), Docker Desktop avviato. `pnpm install && pnpm local:up` avvia tutto lo stack su http://localhost:8080 con Mailpit su http://localhost:8025. Dettagli, comandi e test: [Sviluppo in locale](https://ivanerricis.github.io/easysend/it/development/local).

## Licenza

[MIT](LICENSE). I contributi sono benvenuti: vedi [CONTRIBUTING.md](CONTRIBUTING.md) (in inglese). Segnalazioni di sicurezza: [SECURITY.md](SECURITY.md).
