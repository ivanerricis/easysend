# Security policy

## Supported versions

Only the latest 0.x release receives security fixes. Please update before reporting, if you can: [releases](https://github.com/ivanerricis/easysend/releases).

## Reporting a vulnerability

Report privately with a GitHub Security Advisory:
https://github.com/ivanerricis/easysend/security/advisories/new

Do not open a public issue, pull request or discussion for a vulnerability, and do not post details elsewhere before a fix is released.

Please include:

- the EasySend version (`APP_VERSION`, also shown by `/api/health`) and how you run it;
- what you found and its impact (what an attacker gains, and what they need first);
- steps to reproduce, or a proof of concept;
- logs or screenshots with secrets and personal data removed.

EasySend is maintained by one person. I aim to acknowledge a report within a few days and to keep you updated, but there is no guaranteed timeline: this is a best-effort commitment. When a fix is released, you will be credited in the advisory if you wish.

## Scope

In scope: the EasySend code in this repository and the published images (`easysend-api`, `easysend-web`, `easysend-cloudflared`), including the install and deploy scripts.

Out of scope: Cloudflare and its services, your host, Proxmox, Docker, your SMTP provider, and misconfiguration such as publishing the web port to the network or weak passwords. Reports that need physical or root access to the server are out of scope too.

## Security model

- **Encryption at rest**: files are encrypted on disk with AES-256-GCM in 64 KiB segments. Each file has its own random key, wrapped with a key derived (HKDF) from the master key (`APP_SECRET_KEY` or `/data/secrets/app.key`). TOTP secrets and the SMTP password are encrypted with keys derived from the same master key. The master key can be rotated (README, section 11).
- **Authentication**: argon2id password hashes; server-side sessions with a random token stored only as a SHA-256 hash; mandatory TOTP two-factor authentication for admins; single-use recovery codes stored as HMAC; lockouts and rate limits on login, password reset, download passwords and setup.
- **Requests**: CSRF protection on every unsafe request (signed token plus `Origin` and `Sec-Fetch-Site` checks), Zod validation of all input, an authorization check on every resource (non-owners get 404), a strict Content-Security-Policy.
- **Transport**: TLS ends at Cloudflare; no inbound port is opened on the host. Enable HSTS and "Always Use HTTPS" in Cloudflare.
- **Logs**: IP addresses are stored and logged only as HMAC hashes; download tokens and secrets never appear in logs or error messages. Container logs rotate (3 files of 10 MB). Download and audit logs are kept 90 days.
- **Containers**: read-only root filesystems, all Linux capabilities dropped, `no-new-privileges`, memory limits, non-root users for the web image.
- **Cloudflare API token**: used once by the setup wizard and never stored or logged.

## Accepted risks

- **Plaintext during upload**: the uploaded file is unencrypted in the tus temp folder (same volume as the data) until encryption finishes, then it is deleted. Anyone with access to the volume during that window can read it.
- **No antivirus**: uploaded files are not scanned and there is no preview. A ClamAV sidecar scanning the temp file before encryption is possible future work, not implemented.
- **Web port exposure**: the web container must stay bound to `127.0.0.1`. If it is reachable from the network, clients can spoof `X-Forwarded-For` and `CF-Connecting-IP`, which weakens rate limiting and IP hashing.
- **SMTP test**: an admin can make the server connect to any host and port through the SMTP test. It is admin-only and rate limited (10 per hour); only safe error codes are returned.
- **In-memory rate limits**: counters reset when the api restarts.
- **Master key in the backup**: `scripts/backup.sh` archives contain the master key together with the data, so they must be stored encrypted or offline.
