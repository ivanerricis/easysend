# Uninstall

```sh
./scripts/uninstall.sh            # remove containers, network and images; keep data, .env and .deploy/
./scripts/uninstall.sh --purge    # also delete volumes, .env and .deploy/
```

The default is reversible: `./scripts/deploy.sh <version>` brings everything back. `--purge` offers a backup first and asks you to type `easysend`. The `backups/` directory is kept.

Cloudflare is not touched, because the token is never stored. Clean up by hand:

1. Zero Trust, Networks, Tunnels: delete the tunnel `easysend-...`.
2. Your domain, DNS: delete the CNAME of the hostname.
3. Revoke the API token if you still have it (My Profile, API Tokens).
