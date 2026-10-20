# Sviluppo in locale

Prerequisiti: Node 26 (versione in `.nvmrc`; con [fnm](https://github.com/Schniz/fnm) basta `fnm use`), pnpm 12.14.0 (campo `packageManager`) e Docker Desktop avviato.

```sh
pnpm install
pnpm local:up
```

| Comando            | Cosa fa                                                        |
| ------------------ | -------------------------------------------------------------- |
| `pnpm local:up`    | costruisce e avvia lo stack in Docker (web, api, Mailpit)      |
| `pnpm local:down`  | lo ferma, mantenendo i dati                                    |
| `pnpm local:reset` | lo ferma e cancella i volumi locali                            |
| `pnpm dev`         | api (tsx watch) e Vite fuori da Docker, solo Mailpit in Docker |

Indirizzi:

- Stack Docker: http://localhost:8080 (app), http://localhost:8080/api/health, http://localhost:8025 (Mailpit).
- `pnpm dev`: http://localhost:5173 (Vite con ricaricamento automatico e proxy verso l'api sulla porta 3000). I dati vanno in `.local-data/`.

Mailpit raccoglie tutte le email, qualunque sia il destinatario. Se altri progetti usano le stesse porte, cambiale in `.env.local` (creato da `.env.local.example`): `LOCAL_WEB_PORT`, `MAILPIT_UI_PORT`, `MAILPIT_SMTP_PORT`, `DEV_API_PORT`, `DEV_WEB_PORT`.

Per saltare il wizard puoi creare un admin da riga di comando (solo in modalità locale; chiede la password due volte e il 2FA si configura al primo login):

```sh
pnpm user:create-admin -- --email tu@example.com
# nello stack Docker: docker compose -p easysend-local exec api node dist/cli/create-admin.js --email tu@example.com
```

## Note

- **Browser**: i cookie di sessione sono `Secure`. Chrome, Firefox e Edge li accettano su http://localhost, Safari no. Apri l'app solo da `localhost`, non dall'IP della rete locale.
- **Windows**: si consiglia WSL2 con il progetto nel filesystem Linux (per esempio `~/progetti`), per prestazioni dei volumi e permessi corretti.
- **Disco di Docker Desktop**: in locale lo spazio libero che vede l'app è quello del disco virtuale di Docker Desktop, non del tuo PC. Per ingrandirlo: Docker Desktop, Settings, Resources, Disk image size. Il file del disco virtuale (VHDX) non si riduce da solo quando liberi spazio.

## Sito della documentazione

Questo sito è costruito con [VitePress](https://vitepress.dev) dalla cartella `docs/` (inglese in `docs/`, italiano in `docs/it/`, stessi nomi di file). `pnpm docs:dev` lo serve con ricaricamento automatico e `pnpm docs:build` lo costruisce in `docs/.vitepress/dist`, fallendo sui link morti. Viene pubblicato su GitHub Pages da `.github/workflows/docs.yml` a ogni push su `main` che tocca `docs/`.
