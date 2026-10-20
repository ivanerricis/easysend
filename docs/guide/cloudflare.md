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
