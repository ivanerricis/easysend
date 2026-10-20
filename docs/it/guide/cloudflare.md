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
