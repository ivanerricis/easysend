# Uninstall

```sh
./scripts/uninstall.sh            # remove containers, network and images; keep data, .env and .deploy/
./scripts/uninstall.sh --purge    # also delete volumes, .env and .deploy/
```

The default is reversible: `./scripts/deploy.sh <version>` brings everything back. `--purge` offers a backup first and asks you to type `easysend`. The `backups/` directory is kept. If you use a custom data folder (`DATA_PATH`, see [Data location](./data-location)), `--purge` never deletes it: it prints the path and the command to remove it by hand.

Cloudflare is not touched, because the token is never stored. Clean up by hand:

1. Zero Trust, Networks, Tunnels: delete the tunnel `easysend-...`.
2. Your domain, DNS: delete the CNAME of the hostname.
3. Revoke the API token if you still have it (My Profile, API Tokens).

If you installed the [one-click update](./updates#one-click-update), `uninstall.sh` also removes its systemd units when run as root (otherwise it prints `sudo ./scripts/update-service.sh uninstall`); `--purge` deletes `updates/` too.
