# Security notes

- **Encryption at rest**: each file is encrypted with AES-256-GCM in 64 KiB segments. Every file has its own random key, wrapped with a key derived (HKDF) from the master key.
- **Plaintext on disk during upload**: the uploaded file sits unencrypted in the tus temp folder (same volume, `/data/tmp`) until encryption finishes, then it is deleted. This is an accepted trade-off: encryption runs once the upload is complete, so interrupted uploads can resume.
- **No antivirus**: files are not scanned. A future option is a ClamAV sidecar that scans the temp file before encryption through a hook; it is not implemented.
- **Logs**: IP addresses appear only as HMAC hashes, never in clear. Download tokens are not logged. Container logs rotate (3 files of 10 MB per service). Download and audit logs are kept 90 days.
- **Keep `WEB_BIND` on `127.0.0.1`**. If you publish the web port to the network, clients can spoof `X-Forwarded-For` and `CF-Connecting-IP` and defeat rate limits and IP hashing.
- **HSTS**: enable it in Cloudflare, since TLS ends there.
- **SMTP test**: an admin can make the server connect to any host and port through the SMTP test. It is admin-only and rate limited (10 per hour).
- Passwords use argon2id, sessions are server-side with hashed tokens, CSRF is checked on every unsafe request, and all input is validated with Zod.

## One-click update

An admin session can request an update from the panel, which ends up running `deploy.sh` on the host. This is optional: it only works if you install the runner with `sudo ./scripts/update-service.sh install`, and [removing it](./updates#remove-it) turns the feature off. See [One-click update](./updates#one-click-update). What an admin (or whoever steals an admin session) can trigger, and the defences:

- **No Docker socket and no host access from the container.** The API only writes a text file (`updates/request`: an id, a version and a time) in a bind-mounted folder. A systemd path unit starts `update-runner.sh`, which is a separate process on the host.
- **Only the official releases.** The version must be a published, non-draft, non-pre-release `X.Y.Z` release of the GitHub repository and newer than the running one; the API re-checks it against GitHub when the request is made. The worst case is therefore installing a real newer release, never arbitrary code or a downgrade.
- **Strict validation on the host.** The runner moves the request out of the container-writable folder before reading it, rejects anything but the three expected lines (32 hex id, semantic version, number), caps the size, does not `eval` or `source` it, and writes `status.json` by atomic rename so a symlink in the shared folder cannot redirect it.
- **Admin only**, with CSRF protection, a limit of 5 requests per hour and an audit entry (`system.update_requested`). The panel asks for confirmation before sending it.
- **Contained service.** `easysend-update.service` runs as the owner of the install directory (not necessarily root; it must be in the `docker` group, which is root-equivalent on that host) with `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full` and `ProtectHome=read-only`, and a 45 minute timeout.
- It does not run in local mode (`APP_MODE=local`).

To report a vulnerability see [SECURITY.md](https://github.com/ivanerricis/easysend/blob/main/SECURITY.md).
