# Ricevere file

Di solito un trasferimento va da te a qualcun altro. Una **richiesta di file** funziona al contrario: crei un link, lo condividi e chiunque lo apra può caricare file per te, senza account. Serve per raccogliere documenti dai clienti, foto da un gruppo o un file grande da chi non riesce a mandarlo per email.

## Creare una richiesta

1. Apri **Ricevi file** nella barra laterale e premi **Nuova richiesta**.
2. Compila il modulo e premi **Crea**.
3. Il link (`https://tuo-dominio/r/...`) compare nella pagina. Copialo e mandalo. Lo ritrovi sempre nella pagina della richiesta.

| Opzione                   | Cosa fa                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Titolo                    | Obbligatorio. Lo vede chi carica ed è il titolo di ogni trasferimento che ricevi.                           |
| Istruzioni                | Facoltative. Testo mostrato nella pagina di invio: spiega cosa vuoi ricevere.                               |
| Il link scade dopo        | 3 giorni, 1 settimana o 1 mese. Vale anche per ogni trasferimento ricevuto, dal momento in cui arriva.      |
| Password                  | Facoltativa. Chi apre il link deve inserirla prima di vedere il modulo. Comunicala con un altro canale.     |
| Dimensione massima totale | Facoltativa. Il totale di tutti i file che si possono ricevere con questo link. Conta anche sul tuo spazio. |
| Numero massimo di invii   | Facoltativo. Dopo questo numero di invii completati il link non accetta più file.                           |
| Chiedi il nome / l'email  | Rende il campo obbligatorio nella pagina di invio. Altrimenti sono entrambi facoltativi.                    |

Puoi modificare la richiesta in seguito (le modifiche valgono per i prossimi invii), **revocarla** (il link smette subito di accettare file) o eliminarla. I file già ricevuti restano sempre tra i tuoi trasferimenti.

## Cosa vede chi carica

La pagina di invio mostra le tue istruzioni, lo spazio rimasto e la scadenza. Dopo l'eventuale password, chi carica inserisce nome, email e un messaggio facoltativo, aggiunge uno o più file e li invia. Il caricamento è ripristinabile come gli altri: se la connessione cade, i file già caricati restano e basta selezionare di nuovo quelli mancanti. Alla fine una conferma dice che sei stato avvisato.

Il tuo indirizzo email non viene mai mostrato: la pagina riporta il tuo nome visualizzato o, se non lo hai impostato, il nome dell'istanza.

Se il link è scaduto, revocato o ha raggiunto il numero massimo di invii, la pagina lo dice al posto del modulo. Un file che supera lo spazio rimasto viene rifiutato prima di iniziare il caricamento.

## Dove arrivano i file

- Ogni invio completato ti manda un'email (sempre attiva) con il titolo della richiesta, nome ed email di chi ha caricato, numero e dimensione dei file e un link al trasferimento.
- I file compaiono in **Trasferimenti**. Con il filtro di origine scegli **Ricevuti** per vedere solo quelli. Un trasferimento ricevuto mostra chi lo ha inviato e il suo messaggio, e non ha destinatari né il pulsante di reinvio.
- Un trasferimento ricevuto ha un proprio link di download, come uno che hai inviato: aprilo, copia il link e condividilo con chi vuoi, oppure scarica tu i file e lo zip. Scade dopo la durata scelta per la richiesta e si può revocare o eliminare come ogni trasferimento.

## Limiti e sicurezza

- I file sono cifrati su disco come ogni altro trasferimento e contano sulla tua quota.
- Ogni invio riceve un token di breve durata legato a quel solo caricamento, quindi un visitatore non può toccare i caricamenti degli altri.
- Il link è protetto da limiti di frequenza: 20 nuovi invii all'ora per indirizzo IP e 100 all'ora per richiesta, 10 password sbagliate in 15 minuti per richiesta e indirizzo IP.
- Le richieste scadute o revocate vengono eliminate dalla pulizia oraria; i trasferimenti ricevuti restano fino alla loro scadenza.
- Se elimini un utente, l'admin sceglie se le sue richieste passano a un altro utente o vengono eliminate.
