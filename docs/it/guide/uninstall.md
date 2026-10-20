# Disinstallazione

```sh
./scripts/uninstall.sh            # rimuove container, rete e immagini; mantiene dati, .env e .deploy/
./scripts/uninstall.sh --purge    # cancella anche volumi, .env e .deploy/
```

Il comando predefinito è reversibile: `./scripts/deploy.sh <versione>` riporta tutto com'era. `--purge` propone prima un backup e chiede di digitare `easysend`. La cartella `backups/` viene mantenuta.

Cloudflare non viene toccato, perché il token non è mai salvato. Pulisci a mano:

1. Zero Trust, Networks, Tunnels: elimina il tunnel `easysend-...`.
2. Il tuo dominio, DNS: elimina il CNAME dell'hostname.
3. Revoca il token API se lo hai ancora (My Profile, API Tokens).
