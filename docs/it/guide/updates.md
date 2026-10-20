# Aggiornamento, deploy e rollback

Le note di rilascio sono su [GitHub Releases](https://github.com/ivanerricis/easysend/releases). Per aggiornare:

```sh
cd /opt/easysend
./scripts/deploy.sh            # ultima release
./scripts/deploy.sh 0.2.0      # una versione precisa
```

Cosa fa `deploy.sh [versione] [--force] [--yes]`:

1. controlla Docker, Compose, curl e `.env`, e ricorda la versione attuale in `.deploy/`;
2. scarica e valida il `docker-compose.yml` del tag della release;
3. fa il backup del database (se lo stack è in esecuzione);
4. scarica le immagini, aggiorna `APP_VERSION`, esegue `docker compose up -d --wait`;
5. controlla `/health` e che riporti la nuova versione.

Se qualcosa fallisce dopo il passaggio, versione precedente, file compose e database vengono ripristinati in automatico. La cronologia è in `.deploy/history.log`.

## Rollback

Per tornare a mano alla versione precedente:

```sh
./scripts/rollback.sh              # ripristina anche il database salvato prima dell'ultimo deploy
./scripts/rollback.sh --keep-db    # tiene il database attuale
```

Ripristinare il database scarta tutto ciò che è stato scritto dopo quel deploy (il database attuale viene prima salvato come `app-pre-restore-<ora>.sqlite`). Con `--keep-db` i dati restano, ma una versione più vecchia potrebbe non capire un database già migrato da una più nuova. Le vecchie immagini restano su disco per rendere i rollback rapidi; libera lo spazio con `docker image prune -a` quando non ti servono più.

::: warning Versioni 0.x
Nelle versioni 0.x, le release che cambiano la minor possono contenere modifiche incompatibili. Leggi prima le note di rilascio.
:::
