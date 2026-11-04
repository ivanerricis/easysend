# Inviare file

Apri **Invia file** (la pagina iniziale dopo l'accesso), scegli cosa inviare, imposta le opzioni e fai clic su **Crea link** (oppure **Invia** nella modalità email). I file si caricano a blocchi, si possono riprendere dopo un'interruzione o un refresh della pagina e sono cifrati sul server. Alla fine dell'upload ottieni il link da condividere.

## Cartelle

Puoi inviare intere cartelle, non solo singoli file.

- **Trascina e rilascia.** Rilascia una o più cartelle (e file, insieme) sull'area di upload. Le sottocartelle sono incluse.
- **Scegli cartella.** Fai clic su **Scegli cartella** e seleziona la cartella nella finestra del sistema. Il browser chiede di confermare che può leggere i file: significa solo che i file vengono caricati.
- **La struttura resta.** Una cartella come `progetto/img/logo.png` resta `progetto/img/logo.png`: la selezione raggruppa i file per cartella e puoi togliere un'intera cartella con un clic oppure un solo file al suo interno.
- **I destinatari vedono un albero.** La pagina di download e il dettaglio del trasferimento mostrano le cartelle, che si aprono e si chiudono, con numero di file e dimensione di ciascuna. Ogni file ha il suo pulsante di download; un singolo file si scarica con il proprio nome (`logo.png`, non il percorso).
- **Lo ZIP ricrea le cartelle.** **Scarica tutto in ZIP** (e lo ZIP della selezione) contiene le stesse cartelle e sottocartelle: estraendolo ritrovi la struttura che hai inviato.
- **I file di sistema sono ignorati.** `.DS_Store`, `Thumbs.db` e `desktop.ini` non vengono caricati.
- **I nomi vengono ripuliti.** I nomi di cartelle e file sono ripuliti sul server come sempre (niente path traversal né caratteri di controllo). Se due voci avrebbero lo stesso percorso nello ZIP, la seconda riceve un numero: `report (1).pdf`.
- **Limiti.** Una cartella conta ogni file che contiene nel limite di file per trasferimento. Il valore predefinito è **1000 file**; un admin può cambiarlo da 1 a 5000 in **Impostazioni → Generali → File massimi per trasferimento**. Si accettano cartelle profonde fino a 32 livelli e percorsi fino a 1024 caratteri. I file oltre il limite non vengono aggiunti e il modulo dice quanti ne sono rimasti fuori. Le cartelle vuote non vengono inviate.

Lo stesso selettore di cartelle è disponibile nella pagina di caricamento di una richiesta di file ([Ricevere file](./receiving-files)); le cartelle ricevute compaiono come albero nel trasferimento.
