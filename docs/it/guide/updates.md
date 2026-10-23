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

## Aggiornamento con un clic

Invece di lanciare `deploy.sh` via SSH, un admin può aggiornare da **Impostazioni → Aggiornamenti**. È facoltativo: finché non installi il runner qui sotto, il pannello mostra solo i comandi da eseguire a mano.

Cosa fa e cosa no:

- il container non riceve mai il socket Docker e non esegue comandi sull'host. L'API scrive soltanto un piccolo file di richiesta in una cartella condivisa (`/opt/easysend/updates/`); un'unità systemd **sull'LXC** se ne accorge ed esegue lo stesso `scripts/deploy.sh` che lanceresti a mano;
- si può installare solo una release ufficiale: una release `X.Y.Z` del repository GitHub, pubblicata (non bozza, non pre-release) e più recente della versione in uso. Il server la ricontrolla su GitHub quando avvii l'aggiornamento;
- backup, controllo di salute e rollback automatico sono quelli di `deploy.sh` (vedi sopra). Il pannello e un deploy manuale condividono lo stesso blocco, quindi non girano mai insieme.

### Installare il runner

Una volta, come root, sull'LXC (la cartella di installazione deve stare sotto `/opt`, non sotto `/home`):

```sh
cd /opt/easysend
sudo ./scripts/update-service.sh install              # esegue gli aggiornamenti come proprietario di /opt/easysend
sudo ./scripts/update-service.sh install --user ivan  # oppure come un altro utente
```

L'account che esegue gli aggiornamenti deve essere `root` o far parte del gruppo `docker`. Il comando crea `updates/` (di proprietà dell'uid 1000, l'utente con cui gira l'API, con il gruppo dell'utente del runner, modo `2770`), scrive `updates/runner.json` e le unità `easysend-update.path` ed `easysend-update.service`, e abilita l'unità path. Si può rilanciare senza problemi. Per controllare: `sudo ./scripts/update-service.sh status`.

::: warning Aggiornare da 0.1.x
Il `deploy.sh` della 0.1.x conosce solo i vecchi script, quindi dopo `./scripts/deploy.sh 0.2.0` i due nuovi mancano. Scaricali una volta (dalla 0.2.0 in poi `deploy.sh` li tiene aggiornati):

```sh
cd /opt/easysend
for f in update-runner.sh update-service.sh; do
  curl -fsSL "https://raw.githubusercontent.com/ivanerricis/easysend/v0.2.0/scripts/$f" -o "scripts/$f"
done
chmod +x scripts/update-runner.sh scripts/update-service.sh
sudo ./scripts/update-service.sh install
```

Il vecchio `deploy.sh` non crea nemmeno `updates/`, quindi Docker potrebbe averla creata come root: `install` sistema i permessi.
:::

### Come si usa

1. Apri **Impostazioni → Aggiornamenti**. L'elenco mostra le release più recenti di quella in uso (fino a 30).
2. Scegli una versione, premi **Aggiorna ora** e conferma nella finestra.
3. Il pannello mostra l'avanzamento in tempo reale. Continua a funzionare mentre lo stack si riavvia e riprende lo stato quando l'API torna disponibile.

I passi sono: avvio, file compose, backup del database, scaricamento delle immagini, riavvio, controllo di salute e, solo in caso di errore, rollback.

### Esiti

- **Aggiornato**: la nuova versione è in esecuzione; il pannello propone di ricaricare la pagina.
- **Ripristinato**: la nuova versione non è partita e versione precedente e database sono stati ripristinati in automatico.
- **Fallito**: l'aggiornamento si è fermato, con il motivo (per esempio un altro deploy in corso, file compose non valido, backup non riuscito o rollback non completato). Il messaggio indica il file di log, `.deploy/update.log`.

Una richiesta che il runner non prende in carico entro 2 minuti viene mostrata come "non risponde" e non ne blocca una nuova. Anche un'esecuzione indicata come in corso ma non aggiornata da 45 minuti non blocca più. Nel pannello non c'è un pulsante di rollback: usa `./scripts/rollback.sh` sul server.

### Log e risoluzione dei problemi

- `/opt/easysend/.deploy/update.log` è l'output dell'ultimo aggiornamento (i cinque precedenti restano come `update-<ora>.log`); `.deploy/history.log` ha il riepilogo.
- `journalctl -u easysend-update.service` mostra il runner stesso.
- **"Non risponde"**, o la richiesta non parte mai: `systemctl status easysend-update.path` deve risultare `active (waiting)`. Altrimenti lancia `sudo ./scripts/update-service.sh status` e di nuovo `install`.
- **"L'utente non è nel gruppo docker"**: `sudo usermod -aG docker <utente>`, oppure passa `--user`.
- **Il pannello dice che il runner non è installato**: manca `updates/runner.json`; lancia `install`.
- **L'aggiornamento fallisce con errori di permessi sul file di stato**: probabilmente la cartella di installazione è sotto `/home`. Il servizio gira con `ProtectHome=read-only`; sposta l'installazione in `/opt/easysend`.

### Rimuoverlo

```sh
sudo ./scripts/update-service.sh uninstall
```

Rimuove le unità e `runner.json` e mantiene `updates/`. Anche [`uninstall.sh`](./uninstall) rimuove le unità (da root; altrimenti stampa il comando).

## Avviso di aggiornamento nel pannello admin

Quando esiste una release più recente, gli admin vedono un avviso nella barra laterale e la sezione **Impostazioni → Aggiornamenti** mostra la versione attuale, l'elenco delle release più recenti con le note di rilascio e, a seconda dei casi, il pulsante **Aggiorna ora** (se l'[aggiornamento con un clic](#aggiornamento-con-un-clic) è installato) o i comandi esatti da lanciare sul server.

Per sapere se ci sono nuove release il server chiede a GitHub l'ultima versione pubblicata: solo quando un admin apre il pannello e al massimo una volta al giorno (la risposta resta in memoria per 24 ore). La richiesta non ha corpo né cookie; GitHub vede solo l'indirizzo IP del server e l'header `User-Agent` con la versione in uso. Nessun dato dell'istanza viene inviato. Il controllo si disattiva in **Impostazioni → Generali → Controlla gli aggiornamenti**.
