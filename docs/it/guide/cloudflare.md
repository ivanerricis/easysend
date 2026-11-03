# Token API di Cloudflare

Il wizard usa il token una sola volta per creare il tunnel e il record DNS. Non viene mai salvato né scritto nei log. Permessi minimi:

| Ambito  | Risorsa           | Permesso |
| ------- | ----------------- | -------- |
| Account | Cloudflare Tunnel | Edit     |
| Zone    | DNS               | Edit     |
| Zone    | Zone              | Read     |

Crealo dalla dashboard:

1. My Profile, API Tokens, Create Token, "Create Custom Token".
2. Aggiungi i tre permessi qui sopra.
3. Account Resources: includi solo il tuo account. Zone Resources: includi solo la zona (dominio) che userai.
4. Continue to summary, Create Token, copia il valore e incollalo nel wizard. Puoi revocarlo subito dopo il setup.

Cosa crea il wizard:

- un tunnel chiamato `easysend-<esadecimale casuale>`, riusato se ripeti il passo, con ingress verso `http://web:8080`;
- un CNAME con proxy per il tuo hostname, che punta al tunnel;
- il token del tunnel, scritto nel volume condiviso (`/shared/tunnel-token`, modo 600) e letto da `cloudflared`.

Se esiste già un record DNS con quel nome, il wizard si ferma senza creare nulla. Il TLS termina su Cloudflare, quindi nella dashboard (SSL/TLS) attiva "Always Use HTTPS" e abilita HSTS.

## Cambiare dominio

Puoi cambiare il dominio in seguito dal pannello admin (Impostazioni, Dominio e tunnel). Lo stesso tunnel viene riusato, quindi il token del tunnel non cambia, e viene creato il nuovo CNAME. Il vecchio CNAME viene poi rimosso in automatico, ma solo se punta ancora a questo tunnel e il token può modificare la zona del vecchio dominio; altrimenti il pannello ti dice di eliminarlo dalla dashboard di Cloudflare. I link già condivisi con il vecchio indirizzo smettono di funzionare.

Se hai impostato `PUBLIC_URL` nel file `.env`, ha la precedenza sul nuovo indirizzo: link ed email continuano a usarlo e il pannello mostra un avviso. Aggiorna `PUBLIC_URL` in `.env` e riavvia con `docker compose up -d`.
