# Risoluzione dei problemi

- **Codice di setup non trovato o scaduto**: `docker compose logs api | grep "Setup code"`. Riavviando l'api (`docker compose restart api`) ne viene stampato uno nuovo. Anche un tentativo con codice errato o scaduto ne genera uno nuovo.
- **Il wizard non si apre**: la porta web è legata a `127.0.0.1` dell'LXC. Usa il tunnel SSH del [Primo setup](./first-setup).
- **Il login non resta attivo in locale**: Safari non accetta i cookie `Secure` su http. Usa Chrome, Firefox o Edge e apri `localhost`.
- **Il tunnel non si collega**: `docker compose logs cloudflared`. Controlla che il file del token esista (`docker compose exec api ls -l /shared`) e che il passo Cloudflare del wizard sia finito bene. Il container riavvia da solo il tunnel quando il file del token cambia.
- **"Spazio su disco insufficiente" in upload**: serve `libero - riserva >= 2 x dimensione` ([Requisiti](./requirements)). Libera spazio, elimina vecchi trasferimenti o abbassa la riserva nelle impostazioni admin.
- **Porte già occupate (locale)**: cambiale in `.env.local` ([Sviluppo in locale](../development/local)).
- **Le email non arrivano**: usa la prova SMTP nelle impostazioni admin e guarda `docker compose logs api`. In locale apri Mailpit su http://localhost:8025.
- **Un deploy è fallito ed è tornato indietro**: leggi `.deploy/history.log` e `docker compose logs api`, correggi la causa e rilancia il deploy.
- **L'aggiornamento con un clic non parte o dice "non risponde"**: vedi [Log e risoluzione dei problemi](./updates#log-e-risoluzione-dei-problemi) (`systemctl status easysend-update.path`, `.deploy/update.log`).
