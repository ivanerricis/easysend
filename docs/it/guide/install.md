# Installazione

Le immagini sono pubbliche su GHCR: `ghcr.io/ivanerricis/easysend-api`, `-web` e `-cloudflared`. Non serve fare login al registry. La versione in uso è fissata in `.env` come `APP_VERSION` (mai `latest`).

```sh
sudo mkdir -p /opt/easysend && sudo chown "$USER": /opt/easysend
cd /opt/easysend
V=0.1.0   # la release che vuoi
RAW=https://raw.githubusercontent.com/ivanerricis/easysend/v$V
mkdir -p scripts/lib
curl -fsSL -o docker-compose.yml $RAW/docker-compose.yml
curl -fsSL -o .env.example $RAW/.env.example
for f in deploy.sh rollback.sh backup.sh uninstall.sh lib/common.sh; do
  curl -fsSL -o scripts/$f $RAW/scripts/$f
done
chmod +x scripts/*.sh
cp .env.example .env
chmod 600 .env
./scripts/deploy.sh          # ultima release
# oppure: ./scripts/deploy.sh 0.1.0
```

`deploy.sh` scrive `APP_VERSION` in `.env`, scarica le immagini e avvia lo stack. Per fork o registry privati si imposta `IMAGE_PREFIX` in `.env` (predefinito `ghcr.io/ivanerricis/easysend`).

`.env.example` imposta già `COMPOSE_FILE=docker-compose.yml` e `COMPOSE_PROFILES=tunnel`. Tutto il resto, configurato nel wizard o nel pannello admin, è salvato nel database e non in `.env`.

Per aggiornare dal pannello admin (release 0.2.0 o successive) scarica allo stesso modo anche `update-runner.sh` e `update-service.sh` in `scripts/` e lancia `sudo ./scripts/update-service.sh install`: vedi [Aggiornamento con un clic](./updates#aggiornamento-con-un-clic).

Prossimo passo: [Primo setup (wizard)](./first-setup).
