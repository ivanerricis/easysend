# Note di sicurezza

- **Cifratura a riposo**: ogni file è cifrato con AES-256-GCM a segmenti da 64 KiB. Ogni file ha una propria chiave casuale, protetta con una chiave derivata (HKDF) dalla chiave master.
- **File in chiaro durante l'upload**: il file caricato resta non cifrato nella cartella temporanea di tus (stesso volume, `/data/tmp`) finché la cifratura non termina, poi viene cancellato. È un compromesso accettato: la cifratura parte a upload completato, così gli upload interrotti si possono riprendere.
- **Nessun antivirus**: i file non vengono analizzati. Un'opzione futura è un sidecar ClamAV che analizza il file temporaneo prima della cifratura tramite un hook; non è implementato.
- **Log**: gli indirizzi IP compaiono solo come hash HMAC, mai in chiaro. I token di download non vengono registrati. I log dei container ruotano (3 file da 10 MB per servizio). I log di download e di audit si conservano 90 giorni.
- **Tieni `WEB_BIND` su `127.0.0.1`**. Se pubblichi la porta web sulla rete, i client possono falsificare `X-Forwarded-For` e `CF-Connecting-IP` e aggirare i limiti di richieste e l'hash degli IP.
- **HSTS**: abilitalo su Cloudflare, perché il TLS termina lì.
- **Prova SMTP**: un admin può far connettere il server a qualsiasi host e porta tramite la prova SMTP. È riservata agli admin e limitata (10 all'ora).
- Le password usano argon2id, le sessioni sono lato server con token salvati come hash, il CSRF è controllato su ogni richiesta non sicura e ogni input è validato con Zod.

Per segnalare una vulnerabilità vedi [SECURITY.md](https://github.com/ivanerricis/easysend/blob/main/SECURITY.md) (in inglese).
