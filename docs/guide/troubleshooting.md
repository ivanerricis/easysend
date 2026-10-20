# Troubleshooting

- **Setup code not found or expired**: `docker compose logs api | grep "Setup code"`. Restarting the api (`docker compose restart api`) prints a new one. A wrong or expired attempt also generates a new code.
- **The wizard does not open**: the web port is bound to `127.0.0.1` of the LXC. Use the SSH tunnel of [First setup](./first-setup).
- **Login does not stick on a local run**: Safari does not accept `Secure` cookies on http. Use Chrome, Firefox or Edge, and open `localhost`.
- **The tunnel does not connect**: `docker compose logs cloudflared`. Check that the token file exists (`docker compose exec api ls -l /shared`) and that the Cloudflare step of the wizard ended successfully. The container restarts the tunnel by itself when the token file changes.
- **"Not enough disk space" on upload**: you need `free - reserve >= 2 x size` ([Requirements](./requirements)). Free space, delete old transfers or lower the reserve in the admin settings.
- **Ports already in use (local)**: change them in `.env.local` ([Local development](../development/local)).
- **Emails do not arrive**: use the SMTP test in the admin settings and look at `docker compose logs api`. Locally, open Mailpit on http://localhost:8025.
- **A deploy failed and rolled back**: read `.deploy/history.log` and `docker compose logs api`, fix the cause, then deploy again.
