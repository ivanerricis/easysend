# Cloudflare API token

The wizard uses the token once to create the tunnel and the DNS record. It is never stored or logged. Minimal permissions:

| Scope   | Resource          | Permission |
| ------- | ----------------- | ---------- |
| Account | Cloudflare Tunnel | Edit       |
| Zone    | DNS               | Edit       |
| Zone    | Zone              | Read       |

Create it in the dashboard:

1. My Profile, API Tokens, Create Token, "Create Custom Token".
2. Add the three permissions above.
3. Account Resources: include only your account. Zone Resources: include only the zone (domain) you will use.
4. Continue to summary, Create Token, copy the value and paste it in the wizard. You can revoke it right after the setup.

What the wizard creates:

- one tunnel named `easysend-<random hex>`, reused if you run the step again, with ingress to `http://web:8080`;
- a proxied CNAME for your hostname pointing to the tunnel;
- the tunnel token, written to the shared volume (`/shared/tunnel-token`, mode 600) and read by `cloudflared`.

If a DNS record with that name already exists, the wizard stops without creating anything. TLS ends at Cloudflare, so in the dashboard (SSL/TLS) turn on "Always Use HTTPS" and enable HSTS.

## Changing the domain

You can change the domain later in the admin panel (Settings, Domain and tunnel). The same tunnel is reused, so the tunnel token does not change, and the new CNAME is created. The old CNAME is then removed automatically, but only if it still points to this tunnel and the token can edit the zone of the old domain; otherwise the panel tells you to delete it from the Cloudflare dashboard. Links already shared with the old address stop working.

If you set `PUBLIC_URL` in `.env`, it takes precedence over the new address: links and emails keep using it, and the panel shows a warning. Update `PUBLIC_URL` in `.env` and restart with `docker compose up -d`.
