# EasySend

## Italiano

Applicazione web self-hosted per il trasferimento di file di grandi dimensioni, simile a WeTransfer.

Stato: lavori in corso, fase 1 (fondamenta e contratto API). Il README completo arriva nella fase 6.

### Prerequisiti

- Node 26 (con [fnm](https://github.com/Schniz/fnm): `fnm use`)
- pnpm 12.14.0 (`npm i -g pnpm@12.14.0`)
- Docker Desktop avviato

### Prova in locale

```sh
pnpm install
pnpm local:up
```

`local:up` costruisce le immagini e avvia lo stack. Poi apri:

- http://localhost:8080 per la pagina segnaposto con "Stato API: ok";
- http://localhost:8080/api/health per un JSON con `"status":"ok"` e `"mode":"local"`;
- http://localhost:8025 per Mailpit, che raccoglie le email inviate dall'app.

Per ricaricare il codice mentre lavori usa `pnpm dev` (frontend su http://localhost:5173, API fuori da Docker, solo Mailpit in un container).

Per fermare tutto: `pnpm local:down`. Per fermare e cancellare anche i dati locali: `pnpm local:reset`.

Se altri progetti usano le stesse porte, cambiale in `.env.local` (`LOCAL_WEB_PORT`, `MAILPIT_UI_PORT`, `MAILPIT_SMTP_PORT`, `DEV_API_PORT`, `DEV_WEB_PORT`).

Nota per Windows: il progetto resta in `C:\` (non nel filesystem di WSL2). La raccomandazione di SPEC sezione 11-bis di usare WSL2 non si applica a questa installazione. In locale lo spazio libero rilevato dall'app è quello del disco virtuale di Docker Desktop, non del PC: si aumenta da Docker Desktop, Settings, Resources.

### Documentazione

- [docs/api.md](docs/api.md): contratto API generato.
- [docs/SPEC.md](docs/SPEC.md): requisiti completi.

Licenza: MIT.

## English

Self-hosted web application for transferring large files, similar to WeTransfer.

Status: work in progress, phase 1 (foundations and API contract). The full README arrives in phase 6.

### Prerequisites

- Node 26 (with [fnm](https://github.com/Schniz/fnm): `fnm use`)
- pnpm 12.14.0 (`npm i -g pnpm@12.14.0`)
- Docker Desktop running

### Try it locally

```sh
pnpm install
pnpm local:up
```

`local:up` builds the images and starts the stack. Then open:

- http://localhost:8080 for the placeholder page showing the API status as ok;
- http://localhost:8080/api/health for a JSON with `"status":"ok"` and `"mode":"local"`;
- http://localhost:8025 for Mailpit, which catches the emails sent by the app.

For live reload while developing use `pnpm dev` (frontend on http://localhost:5173, API outside Docker, only Mailpit in a container).

To stop everything: `pnpm local:down`. To stop and also delete the local data: `pnpm local:reset`.

If other projects use the same ports, change them in `.env.local` (`LOCAL_WEB_PORT`, `MAILPIT_UI_PORT`, `MAILPIT_SMTP_PORT`, `DEV_API_PORT`, `DEV_WEB_PORT`).

Windows note: the project lives in `C:\` (not in the WSL2 filesystem). The SPEC section 11-bis recommendation to use WSL2 does not apply to this setup. Locally, the free space the app sees is that of the Docker Desktop virtual disk, not of the PC: increase it in Docker Desktop, Settings, Resources.

### Documentation

- [docs/api.md](docs/api.md): generated API contract.
- [docs/SPEC.md](docs/SPEC.md): full requirements (in Italian).

License: MIT.
