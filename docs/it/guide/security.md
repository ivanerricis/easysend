# Note di sicurezza

- **Cifratura a riposo**: ogni file è cifrato con AES-256-GCM a segmenti da 64 KiB. Ogni file ha una propria chiave casuale, protetta con una chiave derivata (HKDF) dalla chiave master.
- **File in chiaro durante l'upload**: il file caricato resta non cifrato nella cartella temporanea di tus (stesso volume, `/data/tmp`) finché la cifratura non termina, poi viene cancellato. È un compromesso accettato: la cifratura parte a upload completato, così gli upload interrotti si possono riprendere.
- **Nessun antivirus**: i file non vengono analizzati. Un'opzione futura è un sidecar ClamAV che analizza il file temporaneo prima della cifratura tramite un hook; non è implementato.
- **Log**: gli indirizzi IP compaiono solo come hash HMAC, mai in chiaro. I token di download non vengono registrati. I log dei container ruotano (3 file da 10 MB per servizio). I log di download e di audit si conservano 90 giorni.
- **Tieni `WEB_BIND` su `127.0.0.1`**. Se pubblichi la porta web sulla rete, i client possono falsificare `X-Forwarded-For` e `CF-Connecting-IP` e aggirare i limiti di richieste e l'hash degli IP.
- **HSTS**: abilitalo su Cloudflare, perché il TLS termina lì.
- **Prova SMTP**: un admin può far connettere il server a qualsiasi host e porta tramite la prova SMTP. È riservata agli admin e limitata (10 all'ora).
- Le password usano argon2id, le sessioni sono lato server con token salvati come hash, il CSRF è controllato su ogni richiesta non sicura e ogni input è validato con Zod.

## Aggiornamento con un clic

Una sessione admin può richiedere un aggiornamento dal pannello, che finisce per eseguire `deploy.sh` sull'host. È facoltativo: funziona solo se installi il runner con `sudo ./scripts/update-service.sh install`, e [rimuoverlo](./updates#rimuoverlo) disattiva la funzione. Vedi [Aggiornamento con un clic](./updates#aggiornamento-con-un-clic). Cosa può far partire un admin (o chi ruba una sessione admin) e le difese:

- **Niente socket Docker né accesso all'host dal container.** L'API scrive soltanto un file di testo (`updates/request`: un id, una versione e un'ora) in una cartella montata. Un'unità systemd di tipo path avvia `update-runner.sh`, che è un processo separato sull'host.
- **Solo le release ufficiali.** La versione deve essere una release `X.Y.Z` del repository GitHub, pubblicata, non bozza, non pre-release e più recente di quella in uso; l'API la ricontrolla su GitHub quando riceve la richiesta. Il caso peggiore è quindi installare una vera release più recente, mai codice arbitrario né un downgrade.
- **Validazione rigorosa sull'host.** Il runner sposta la richiesta fuori dalla cartella scrivibile dal container prima di leggerla, rifiuta tutto tranne le tre righe attese (id di 32 caratteri esadecimali, versione semantica, numero), limita la dimensione, non usa `eval` né `source`, e scrive `status.json` con un rename atomico così un symlink nella cartella condivisa non lo può reindirizzare.
- **Solo admin**, con protezione CSRF, un limite di 5 richieste all'ora e una riga di audit (`system.update_requested`). Il pannello chiede conferma prima di inviarla.
- **Servizio contenuto.** `easysend-update.service` gira come proprietario della cartella di installazione (non per forza root; deve far parte del gruppo `docker`, che su quell'host equivale a root) con `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full` e `ProtectHome=read-only`, e un timeout di 45 minuti.
- Non funziona in modalità locale (`APP_MODE=local`).

Per segnalare una vulnerabilità vedi [SECURITY.md](https://github.com/ivanerricis/easysend/blob/main/SECURITY.md) (in inglese).
