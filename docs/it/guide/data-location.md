# Posizione dei dati

Di default EasySend tiene tutto ciò che salva (database, file cifrati, loghi, chiave master) nel volume Docker `easysend-data`, che sta sul disco dove Docker tiene i suoi dati (`/var/lib/docker`). Se quel disco è piccolo, o vuoi i dati su un secondo disco, su una condivisione NAS o in una cartella che salvi con altri strumenti, punta `DATA_PATH` a una cartella a tua scelta.

Cambia solo il volume dei dati. Il piccolo volume `easysend-shared` (il token del tunnel) resta un volume Docker.

## 1. Scegliere la cartella (LXC su Proxmox)

In un LXC non privilegiato il disco va prima assegnato al container. Due modi usuali, sull'host Proxmox:

- **Un nuovo disco per il container** (il più semplice). Proxmox lo crea e lo formatta, e dentro il container compare come una normale cartella:

  ```sh
  pct set 200 -mp0 local-lvm:200,mp=/mnt/dati   # volume da 200 GB montato in /mnt/dati
  ```

- **Una cartella esistente dell'host o un secondo disco fisico.** Monta il disco sull'host (per esempio in `/mnt/disk2`), crea una cartella e assegnala all'utente del container. In un container non privilegiato l'uid 1000 del container è l'uid 101000 sull'host:

  ```sh
  mkdir -p /mnt/disk2/easysend
  chown 101000:101000 /mnt/disk2/easysend
  pct set 200 -mp0 /mnt/disk2/easysend,mp=/mnt/dati/easysend
  ```

Riavvia il container (`pct reboot 200`) perché il punto di mount compaia. Su un host Debian o una VM senza LXC va bene qualsiasi cartella locale.

## 2. Crearla con il proprietario giusto

L'api gira come uid/gid 1000 e non parte se non può scrivere nella cartella. Dentro l'LXC:

```sh
sudo install -d -o 1000 -g 1000 /mnt/dati/easysend
```

`DATA_PATH` deve essere un percorso assoluto che esiste, senza barra finale e senza `:`.

## 3. Impostare DATA_PATH e fare il deploy

Aggiungi la riga a `.env` (vedi `.env.example`) e lancia lo script di deploy, che controlla la cartella (esiste, è una directory, scrivibile da uid 1000) prima di toccare lo stack in esecuzione:

```sh
echo 'DATA_PATH=/mnt/dati/easysend' >> .env
./scripts/deploy.sh --force
```

Su una installazione nuova è tutto: la cartella è vuota ed EasySend crea un database nuovo al suo interno. Se il deploy si ferma con codice di uscita 22 la cartella non va, e il messaggio dice cosa correggere. La pagina admin **Spazio** mostra la cartella, lo spazio libero di quel disco e la riserva.

## Spostare dati esistenti

Fallo solo se hai già dati nel volume. Prevedi un breve fermo.

```sh
cd /opt/easysend

# 1. fai prima un backup e conserva l'archivio (contiene anche la chiave master)
./scripts/backup.sh

# 2. ferma lo stack (il volume resta)
docker compose stop

# 3. copia il volume nella cartella, mantenendo proprietari e permessi
#    (<progetto> è il nome del progetto Compose: vedi `docker volume ls`)
docker run --rm -v <progetto>_easysend-data:/from:ro -v /mnt/dati/easysend:/to alpine:3.24.2 \
  sh -c 'cp -a /from/. /to/'

# 4. controlla: il proprietario deve essere 1000 e devono esserci db/, storage/, secrets/
ls -ln /mnt/dati/easysend
du -sh /mnt/dati/easysend

# 5. usa la cartella e riavvia
echo 'DATA_PATH=/mnt/dati/easysend' >> .env
./scripts/deploy.sh --force
```

Verifica prima di cancellare qualsiasi cosa: accedi, apri **Spazio** (deve mostrare la cartella dell'host), apri un trasferimento e scarica un file. Solo quando tutto funziona, e dopo aver messo al sicuro altrove un archivio di backup, elimina il vecchio volume:

```sh
docker volume rm <progetto>_easysend-data
```

Per tornare al volume, togli la riga `DATA_PATH` e rifai il deploy: il volume deve contenere ancora i dati che vuoi.

## Backup, rollback e disinstallazione

- `./scripts/backup.sh` legge la cartella quando `DATA_PATH` è impostato ([Backup e ripristino](./backup)).
- `./scripts/rollback.sh` si rifiuta di tornare a una versione precedente a questa funzione finché `DATA_PATH` è impostato: quella versione ignorerebbe la cartella e partirebbe su un volume vuoto. I tuoi dati non vengono toccati.
- `./scripts/uninstall.sh --purge` non cancella mai la cartella: stampa il percorso e il comando per eliminarla a mano ([Disinstallazione](./uninstall)).
