# Archiviazione S3

Di default i file cifrati stanno sul disco locale del server (`/data/storage`). Se quel disco è piccolo, puoi salvarli su un servizio compatibile S3: Cloudflare R2, MinIO, AWS S3, Backblaze B2, Wasabi e simili. È facoltativo e puoi cambiare in qualsiasi momento.

## Quando conviene

- Il disco dell'LXC è piccolo e non vuoi ingrandirlo.
- Hai già un bucket (o un server MinIO) con molto spazio.
- Vuoi i file fuori dall'host, così un disco perso non significa file persi (per l'altro lato della medaglia vedi [Backup](./backup)).

Se il disco locale è abbastanza grande, restaci: è la configurazione più semplice, senza altri servizi, senza costi di traffico e senza altro da salvare a parte.

## Come funziona

- I file vengono cifrati da EasySend prima di lasciare il server, con lo stesso formato che hanno su disco. Il bucket contiene solo oggetti cifrati con nomi casuali (UUID); le chiavi restano nel database e la chiave master non lascia mai il server.
- Download e zip passano in streaming da EasySend (legge l'oggetto a intervalli e decifra al volo). I visitatori non parlano mai con il bucket e il bucket non deve essere pubblico. L'uso di RAM resta costante.
- Ogni file ricorda dove è salvato. Cambiare archiviazione riguarda solo i **nuovi** file; quelli esistenti restano dove sono finché non li sposti (vedi [Spostare i file](#spostare-i-file)). In quel periodo le due archiviazioni funzionano insieme.
- La secret key S3 è salvata cifrata nel database, come la password SMTP.

### Cosa resta sempre in locale

| Cosa                                           | Perché                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Database, sessioni, impostazioni               | SQLite in `/data/db`.                                                                                                           |
| Chiave master e segreti                        | `/data/secrets`.                                                                                                                |
| Loghi, favicon, sfondo                         | `/data/branding`.                                                                                                               |
| File temporanei di upload (tus) in `/data/tmp` | Un upload arriva prima sul disco locale e, a caricamento completato, viene cifrato e inviato al bucket. Poi vengono cancellati. |

Spazio su disco: con il disco locale un upload richiede **il doppio** della sua dimensione libera (l'upload più la copia cifrata). Con S3 richiede **una volta** la sua dimensione libera in `/data/tmp`, perché la copia cifrata va direttamente al bucket. La riserva impostata nelle impostazioni generali vale comunque. Sul bucket EasySend non controlla alcun limite: tieni d'occhio la quota del provider.

## Impostazioni per provider

Compila questi campi in **Impostazioni > Archiviazione** (o nel passo "Dove salvare i file" del wizard). Il pannello mostra gli stessi esempi sotto "Esempi di endpoint".

| Provider      | Endpoint                                        | Regione                                | Path-style |
| ------------- | ----------------------------------------------- | -------------------------------------- | ---------- |
| Cloudflare R2 | `https://<account-id>.r2.cloudflarestorage.com` | `auto`                                 | no         |
| MinIO         | `http://minio:9000` o il tuo indirizzo HTTPS    | `us-east-1` (il predefinito)           | **sì**     |
| AWS S3        | `https://s3.<regione>.amazonaws.com`            | la regione del bucket, es. `eu-west-1` | no         |
| Backblaze B2  | `https://s3.<regione>.backblazeb2.com`          | es. `eu-central-003`                   | no         |
| Wasabi        | `https://s3.<regione>.wasabisys.com`            | es. `eu-central-1`                     | no         |

- **Bucket**: crealo prima, privato. **Prefisso** è una cartella facoltativa dentro il bucket (per esempio `easysend`), utile se il bucket è condiviso. EasySend legge e scrive solo gli oggetti sotto quel prefisso.
- **Path-style** mette il bucket nel percorso dell'URL (`https://host/bucket/chiave`) invece che nel nome host (`https://bucket.host/chiave`). Attivalo per MinIO e per ogni server senza DNS wildcard per i bucket.
- La regione deve essere quella che il provider si aspetta, altrimenti la firma viene rifiutata (la prova di connessione lo segnala).
- Usa una coppia di chiavi creata solo per EasySend, limitata a quel bucket.

### Permessi

La chiave deve poter eseguire queste azioni sul bucket (e sugli oggetti al suo interno, sotto il prefisso se ne usi uno):

- `PutObject`, `GetObject`, `DeleteObject`;
- `ListBucket` (per trovare gli avanzi e provare la connessione);
- quelle del multipart, usato per i file grandi: `AbortMultipartUpload`, `ListBucketMultipartUploads`, `ListMultipartUploadParts`.

Su AWS S3, per un bucket chiamato `easysend-files`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:ListBucketMultipartUploads"],
      "Resource": "arn:aws:s3:::easysend-files"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": "arn:aws:s3:::easysend-files/*"
    }
  ]
}
```

Su Cloudflare R2 crea un token API con **Object Read & Write** limitato al bucket. Su B2 e Wasabi crea una application key / un utente limitato al bucket con lettura, scrittura ed eliminazione.

### Regola di ciclo di vita per gli upload incompleti

I file grandi vengono inviati al bucket a parti (multipart upload, 16 MB a parte). Se il server si ferma a metà, le parti già inviate restano nel bucket e, per la maggior parte dei provider, vengono fatturate finché qualcuno non le rimuove. EasySend annulla quelle più vecchie di 24 ore all'avvio e durante la pulizia oraria, ma è buona norma aggiungere una regola sul bucket come rete di sicurezza: **annulla gli upload multipart incompleti dopo 1-7 giorni** (AWS: regola di lifecycle "Delete expired object delete markers or incomplete multipart uploads"; R2 e B2 hanno la stessa opzione nelle impostazioni del bucket).

### Traffico e costi

Ogni download passa da bucket -> EasySend -> visitatore, quindi un trasferimento scaricato N volte legge i suoi byte N volte dal bucket. I provider qui sono molto diversi: AWS S3 fa pagare il traffico in uscita dal bucket, mentre Cloudflare R2 e Wasabi non fanno pagare l'egress (Wasabi ha un periodo minimo di archiviazione e una politica di uso equo) e B2 offre una quota gratuita. Controlla prezzi e limiti aggiornati del tuo provider prima di spostare grandi quantità di dati. Serve anche abbastanza banda sul server: upload e download passano da lì.

## Scegliere l'archiviazione

### Dal pannello (consigliato)

1. Apri **Impostazioni > Archiviazione**, scegli **Archiviazione compatibile S3** e compila i campi.
2. Premi **Prova connessione**. EasySend scrive, legge ed elimina un oggetto di prova nel bucket. Se fallisce, ne mostra il motivo (accesso negato, bucket inesistente, chiavi o regione errate, timeout, server non raggiungibile).
3. **Salva** si abilita solo dopo una prova riuscita con esattamente questi valori. Se cambi un campo devi riprovare.

Da quel momento i nuovi file vanno su S3. La pagina mostra quanti file e quanti byte ci sono su ciascuna archiviazione.

Finché ci sono file su S3, **endpoint, bucket e prefisso sono bloccati** (renderebbero irraggiungibili quei file). Regione, path-style e chiavi si possono ancora cambiare dopo una nuova prova, per esempio per ruotare le chiavi. Per cambiare bucket, sposta prima i file sul disco locale.

Per tornare al disco scegli **Disco locale** e salva: non serve nessuna prova. Le impostazioni S3 restano memorizzate.

### Dal `.env` al primo avvio

Per le installazioni automatiche puoi preimpostare l'archiviazione prima del primo avvio, nel `.env`:

```sh
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=easysend-files
S3_PREFIX=
S3_FORCE_PATH_STYLE=false
S3_ACCESS_KEY_ID=...
# la secret key: direttamente, oppure (meglio) in un file dentro /data/secrets
S3_SECRET_ACCESS_KEY=...
S3_SECRET_ACCESS_KEY_FILE=s3.key
```

`S3_SECRET_ACCESS_KEY_FILE` è un percorso relativo a `/data/secrets` (la cartella della chiave master): mettici la chiave con modo 600 e lascia vuoto `S3_SECRET_ACCESS_KEY`, così il segreto non sta nel `.env`. `STORAGE_DRIVER` vuoto o `local` significa disco locale. Una configurazione S3 incompleta o non valida blocca l'avvio con un messaggio che nomina le variabili (mai i loro valori).

::: warning Le variabili si leggono una volta sola
Vengono importate al **primo avvio** (quando non esiste ancora l'impostazione di archiviazione) e salvate, cifrate, nel database. Da allora la fonte di verità è il database e le variabili vengono ignorate: modificare il `.env` più tardi non ha effetto. Se le impostazioni in uso sono diverse dalle variabili, la pagina Archiviazione mostra un avviso; modifica le impostazioni dal pannello.
:::

## Spostare i file

Cambiare archiviazione non sposta nulla. Per spostare i file esistenti:

### Dal pannello

In **Impostazioni > Archiviazione**, la scheda **Sposta i file tra le archiviazioni** mostra quanti file si trovano sull'altra archiviazione rispetto a quella in uso. Premi il pulsante, conferma e segui l'avanzamento. Puoi interrompere in qualsiasi momento: i file già spostati restano spostati e gli altri restano dove erano. Gli utenti possono continuare a scaricare durante lo spostamento.

### Da riga di comando

```sh
docker compose exec api node dist/cli/storage-migrate.js --to local --dry-run   # solo conteggio
docker compose exec api node dist/cli/storage-migrate.js --to s3
docker compose exec api node dist/cli/storage-migrate.js --to local
```

(`pnpm storage:migrate -- --to s3|local [--dry-run]` in un checkout di sviluppo.) Stampa l'avanzamento e si ferma in modo pulito con Ctrl+C. `--to s3` richiede che le impostazioni S3 siano già salvate; `--to local` controlla che il disco abbia spazio per tutto.

### Cosa succede durante lo spostamento

- I byte cifrati vengono copiati **così come sono** (nessuna ricifratura, le chiavi non cambiano), un file alla volta, con memoria costante.
- Un file passa alla nuova archiviazione solo dopo essere stato copiato per intero. Un download che sta già leggendo la vecchia copia finisce normalmente.
- L'originale viene **eliminato dopo circa un'ora**, dal job di pulizia orario. In quell'ora esistono entrambe le copie, quindi calcola lo spazio in più (disco o bucket).
- Se il server si riavvia a metà, lo spostamento riprende da solo. Se un file non si riesce a spostare, gli altri proseguono e l'esito indica quanti sono falliti; rilancia lo spostamento per riprovare.
- Ne gira uno solo alla volta.

## Backup

Lo script e l'archivio di backup **non** includono i file salvati su S3. Fai il backup del bucket con gli strumenti del provider (versioning, replica) o con `rclone sync`. Il backup del database nell'archivio contiene la chiave avvolta di ogni file e le impostazioni S3 cifrate, e nell'archivio c'è anche la chiave master: il bucket insieme all'archivio basta per ripristinare. Vedi [Backup e ripristino](./backup).

## Risoluzione dei problemi

- **La prova di connessione dice "accesso negato"**: alla chiave manca uno dei permessi sopra, oppure è limitata a un altro bucket o prefisso.
- **"Le chiavi o la regione non sono corrette"**: controlla la secret key e la regione del bucket; con R2 la regione è `auto`.
- **"Il bucket non esiste"**: nome sbagliato, oppure endpoint o regione sbagliati per quel bucket.
- **"Il servizio non è raggiungibile"** con un MinIO self-hosted: dal container api l'indirizzo deve risolversi ed essere raggiungibile (`docker compose exec api wget -S -O- <endpoint>/minio/health/live`); un nome che funziona solo sul tuo PC non basta.
- **I download falliscono con "storage non disponibile"**: il bucket non ha risposto. Controlla lo stato del provider e i log dell'api (`docker compose logs api`); contengono l'operazione e il nome dell'oggetto, mai le chiavi.
